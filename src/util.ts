import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

export function homeSporeDir(): string {
  return path.join(os.homedir(), '.spore-code');
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, {recursive: true});
}

export function safeWriteFile(file: string, content: string, mode = 0o600): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, {mode});
  try {
    fs.chmodSync(tmp, mode);
  } catch {
    // chmod is best-effort on Windows.
  }
  fs.renameSync(tmp, file);
}

export function sha256Short(input: string, len = 8): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, len);
}

export function timestampId(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function safeSessionId(id: string): string {
  return id.replace(/[:@/\\]/g, '_').slice(0, 80);
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n... [truncated ${s.length - max} chars]`;
}

export function commandExists(command: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const res = spawnSync(probe, args, {stdio: 'ignore', shell: process.platform !== 'win32'});
  return res.status === 0;
}

export function runCapture(command: string, cwd: string, timeoutMs = 10_000): string {
  const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
  const flag = process.platform === 'win32' ? '/d /s /c' : '-c';
  const res = spawnSync(shell, [...flag.split(' '), command], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true
  });
  return `${res.stdout || ''}${res.stderr || ''}`.trim();
}

export function findGitRoot(cwd: string): string {
  const out = runCapture('git rev-parse --show-toplevel', cwd, 5000);
  return out && !out.toLowerCase().includes('fatal:') ? path.resolve(out.split(/\r?\n/)[0] || cwd) : '';
}

export function projectNameFromRoot(root: string): string {
  return path.basename(root || process.cwd()) || 'project';
}

export function normalizeSlash(p: string): string {
  return p.split(path.sep).join('/');
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
