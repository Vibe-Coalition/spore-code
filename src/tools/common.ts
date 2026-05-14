import fs from 'node:fs';
import path from 'node:path';

export type ToolInput = Record<string, unknown>;
export type ToolResult = Record<string, unknown> | string | null;

export const noiseDirs = new Set([
  '.git', 'node_modules', '.venv', 'venv', 'env', '__pycache__', 'dist', 'build',
  'target', 'out', '.next', '.cache', '.spore-code', 'vendor', '.gradle', '.mvn',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.turbo', '.nuxt', '.svelte-kit',
  '.terraform', '.idea', '.vscode', 'coverage', '.nyc_output', '.DS_Store'
]);

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return /^(1|true|yes|on)$/i.test(v);
  if (typeof v === 'number') return v !== 0;
  return fallback;
}

export function asInt(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v);
  return fallback;
}

export function firstString(input: ToolInput, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const v = input[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return fallback;
}

export function stringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => String(x)).filter(Boolean);
  if (typeof v === 'string') return v.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
  return [];
}

export function resolvePath(raw: string, cwd: string, scope: string): string {
  if (!raw) throw new Error('path is required');
  const resolved = path.resolve(cwd, raw);
  if (scope === 'expanded') return resolved;
  const root = path.resolve(cwd);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`path ${resolved} is outside the working directory ${root} (use /scope expanded to broaden)`);
  }
  return resolved;
}

export function readText(file: string, maxBytes = 100 * 1024 * 1024): string {
  const st = fs.statSync(file);
  if (st.isDirectory()) throw new Error(`${file} is a directory`);
  if (st.size > maxBytes) throw new Error(`file too large: ${st.size} bytes > cap ${maxBytes}`);
  return fs.readFileSync(file, 'utf8');
}

export function truncateOutput(s: string, limit = 20_000): string {
  if (s.length <= limit) return s;
  const keep = Math.floor(limit / 2);
  return `${s.slice(0, keep)}\n\n[... ${s.length - limit} chars truncated ...]\n\n${s.slice(-keep)}`;
}

export function errorResult(err: unknown): {error: string} {
  return {error: err instanceof Error ? err.message : String(err)};
}
