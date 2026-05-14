import {spawn, execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import type {BackgroundManager, Proc} from './background.js';
import {asBool, asInt, errorResult, firstString, truncateOutput, type ToolInput} from './common.js';

const execFileAsync = promisify(execFile);

const dangerousPatterns = ['rm -rf /', 'mkfs', '> /dev/sd', ':(){:|:&};:', 'chmod -R 777 /'];
const serverHints = [
  'npm start', 'npm run dev', 'npm run serve', 'yarn start', 'yarn dev', 'pnpm start',
  'pnpm dev', 'bun dev', 'next dev', 'vite', 'nuxt dev', 'astro dev', 'expo start',
  'nodemon', 'python -m http.server', 'python3 -m http.server', 'flask run', 'uvicorn',
  'streamlit run', 'cargo run', 'rails server', 'hugo serve', 'go run ', 'docker compose up',
  'tail -f', 'watch '
];

export async function execTool(input: ToolInput, cwd: string, logDir: string, bg: BackgroundManager, onLine?: (line: string) => void, scope = ''): Promise<Record<string, unknown>> {
  const command = firstString(input, ['command', 'cmd', 'shell_command', 'shellCommand']);
  if (!command) return {error: 'command is required'};
  const blocked = safetyError(command) || scopeSafetyError(command, cwd, scope);
  if (blocked) return {error: blocked, blocked: true, scope: scope || 'strict'};
  if (String(command).trim().startsWith('/bg')) {
    return handleBg(command.replace(/^\s*\/bg\s*/, ''), bg);
  }
  if (asBool(input.background, false) || serverHints.some(h => command.includes(h))) {
    const proc = bg.launch(command, cwd);
    await new Promise(resolve => setTimeout(resolve, 1200));
    return {
      ok: true,
      backgrounded: true,
      processId: proc.id,
      logFile: proc.logFile,
      output: proc.output.slice(-80).join('\n'),
      note: `Running in background as #${proc.id}. Use bg_tail with id ${proc.id}; bg_kill stops it.`
    };
  }
  const timeoutMs = Math.min(Math.max(asInt(input.timeout, 120_000), 250), 600_000);
  const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
  const logFile = path.join(logDir, `exec-${Date.now()}.log`);
  fs.mkdirSync(logDir, {recursive: true});
  fs.writeFileSync(logFile, `# Command: ${command}\n# Time: ${new Date().toISOString()}\n\n`);
  return await new Promise(resolve => {
    const child = spawn(shell, args, {cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    const lines: string[] = [];
    let output = '';
    let done = false;
    let adopted: Proc | null = null;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      const proc = bg.adopt(command, cwd, child, logFile, lines);
      adopted = proc;
      resolve({
        output: truncateOutput(output, 8000),
        exitCode: -1,
        timedOut: true,
        backgrounded: true,
        pending: true,
        running: true,
        processId: proc.id,
        logFile,
        note: `Foreground exec hit ${timeoutMs}ms and was adopted as background process #${proc.id}.`
      });
    }, timeoutMs);
    const append = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      fs.appendFileSync(logFile, text);
      if (adopted) bg.recordOutput(adopted, text, false);
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        lines.push(line);
        onLine?.(line);
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', err => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(errorResult(err));
    });
    child.on('exit', code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fs.appendFileSync(logFile, `\n# Exit: ${code ?? -1}\n`);
      resolve({output: truncateOutput(output, 8000), exitCode: code ?? -1, logFile});
    });
  });
}

export async function powershellExecTool(input: ToolInput, cwd: string, logDir: string, scope = ''): Promise<Record<string, unknown>> {
  const command = firstString(input, ['command', 'script']);
  if (!command) return {error: 'command is required'};
  const blocked = safetyError(command) || scopeSafetyError(command, cwd, scope);
  if (blocked) return {error: blocked, blocked: true, scope: scope || 'strict'};
  const exe = await findPowerShell();
  if (!exe) return {error: 'PowerShell executable not found on PATH (checked pwsh and powershell)'};
  const args = path.basename(exe).toLowerCase().startsWith('powershell')
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]
    : ['-NoProfile', '-Command', command];
  try {
    const timeout = Math.min(Math.max(asInt(input.timeout, 120_000), 250), 600_000);
    const {stdout, stderr} = await execFileAsync(exe, args, {cwd, timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024});
    const output = `${stdout || ''}${stderr || ''}`.trimEnd();
    const logFile = path.join(logDir, `powershell-${Date.now()}.log`);
    fs.mkdirSync(logDir, {recursive: true});
    fs.writeFileSync(logFile, output);
    return {output: truncateOutput(output, 8000), exitCode: 0, executable: exe, logFile};
  } catch (err: any) {
    return {error: err.message, output: truncateOutput(`${err.stdout || ''}${err.stderr || ''}`, 8000), exitCode: typeof err.code === 'number' ? err.code : -1, executable: exe};
  }
}

function safetyError(command: string): string {
  for (const p of dangerousPatterns) if (command.includes(p)) return `Blocked dangerous command pattern: ${p}`;
  for (const p of ['/etc/shadow', '/etc/sudoers', '~/.aws/credentials', '~/.kube/config']) {
    if (command.includes(p)) return `Command references sensitive path: ${p}`;
  }
  return '';
}

function scopeSafetyError(command: string, cwd: string, scope: string): string {
  if (scope === 'expanded') return '';
  const root = path.resolve(cwd);
  const tokens = command.match(/"[^"]+"|'[^']+'|[^\s]+/g) || [];
  for (const raw of tokens) {
    const token = raw.replace(/^['"]|['"]$/g, '').replace(/[),;]+$/g, '');
    if (!token || token.startsWith('-')) continue;
    if (token === '..' || token.startsWith('../') || token.startsWith('..\\') || token.includes('/../') || token.includes('\\..\\')) {
      return `Command references a path outside the working directory: ${token} (use /scope expanded to broaden)`;
    }
    const looksAbsolute = path.isAbsolute(token) || path.win32.isAbsolute(token);
    if (!looksAbsolute) continue;
    const resolved = path.resolve(token);
    const winResolved = path.win32.resolve(token).toLowerCase();
    const winRoot = path.win32.resolve(root).toLowerCase();
    const insideNative = resolved === root || resolved.startsWith(root + path.sep);
    const insideWin = winResolved === winRoot || winResolved.startsWith(winRoot + '\\');
    if (!insideNative && !insideWin) {
      return `Command references absolute path outside the working directory: ${token} (use /scope expanded to broaden)`;
    }
  }
  return '';
}

async function findPowerShell(): Promise<string> {
  const candidates = process.platform === 'win32' ? ['pwsh.exe', 'powershell.exe', 'pwsh', 'powershell'] : ['pwsh', 'powershell'];
  for (const c of candidates) {
    try {
      const {stdout} = await execFileAsync(process.platform === 'win32' ? 'where' : 'command', process.platform === 'win32' ? [c] : ['-v', c], {windowsHide: true});
      const first = String(stdout).split(/\r?\n/)[0]?.trim();
      if (first) return first;
    } catch {}
  }
  return '';
}

function handleBg(args: string, bg: BackgroundManager): Record<string, unknown> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (!parts.length || parts[0] === 'list') return {ok: true, processes: bg.list()};
  if (parts[0] === 'kill') return bg.kill(Number(parts[1]));
  return bg.tail(Number(parts[0]));
}
