import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {errorResult, firstString, truncateOutput, type ToolInput} from './common.js';

const execFileAsync = promisify(execFile);

export async function gitStatusTool(input: ToolInput, cwd: string): Promise<Record<string, unknown>> {
  try {
    const dir = firstString(input, ['path', 'cwd'], cwd);
    const status = await git(dir, ['status', '--short', '--branch']);
    const stat = await git(dir, ['diff', '--stat']).catch(() => '');
    return {ok: true, path: dir, output: truncateOutput([status.trimEnd(), stat.trimEnd()].filter(Boolean).join('\n\n'), 12_000)};
  } catch (err) {
    return errorResult(err);
  }
}

export async function gitDiffTool(input: ToolInput, cwd: string): Promise<Record<string, unknown>> {
  try {
    const args = ['diff'];
    if (input.staged) args.push('--staged');
    if (input.stat) args.push('--stat');
    const ref = firstString(input, ['ref']);
    if (ref) args.push(ref);
    const file = firstString(input, ['file', 'path', 'file_path', 'filePath']);
    if (file) args.push('--', file);
    const out = await git(cwd, args);
    return {ok: true, output: truncateOutput(out, 40_000), exit: 0};
  } catch (err: any) {
    return {ok: false, error: err.message, output: truncateOutput(`${err.stdout || ''}${err.stderr || ''}`, 40_000), exit: typeof err.code === 'number' ? err.code : 1};
  }
}

export async function runTestsTool(input: ToolInput, cwd: string, scope = ''): Promise<Record<string, unknown>> {
  const supplied = firstString(input, ['command', 'cmd']);
  const candidates = supplied ? [supplied] : ['npm test', 'pnpm test', 'yarn test', 'go test ./...', 'pytest -q', 'python -m pytest -q'];
  for (const command of candidates) {
    const available = command.startsWith('npm') ? exists(cwd, 'package.json')
      : command.startsWith('pnpm') ? exists(cwd, 'pnpm-lock.yaml')
      : command.startsWith('yarn') ? exists(cwd, 'yarn.lock')
      : command.startsWith('go ') ? exists(cwd, 'go.mod')
      : command.includes('pytest') ? (exists(cwd, 'pyproject.toml') || exists(cwd, 'pytest.ini') || exists(cwd, 'requirements.txt'))
      : true;
    if (!available) continue;
    const {execTool} = await import('./shell.js');
    const {BackgroundManager} = await import('./background.js');
    return await execTool({command, timeout: input.timeout ?? 300_000}, cwd, `${cwd}/.spore-code/logs`, new BackgroundManager(`${cwd}/.spore-code/logs`), undefined, scope);
  }
  return {error: 'No test command supplied and no standard project test command detected'};
}

async function git(cwd: string, args: string[]): Promise<string> {
  const {stdout, stderr} = await execFileAsync('git', args, {cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024});
  return `${stdout || ''}${stderr || ''}`;
}

function exists(cwd: string, file: string): boolean {
  return fs.existsSync(path.join(cwd, file));
}
