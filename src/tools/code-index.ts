import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import {findGitRoot, normalizeSlash, runCapture, safeWriteFile, truncate} from '../util.js';
import {asInt, errorResult, firstString, noiseDirs, type ToolInput} from './common.js';

interface SymbolRow {
  qname: string;
  name: string;
  kind: string;
  file: string;
  startLine: number;
  endLine: number;
  signature: string;
  language: string;
  container?: string;
  exported?: boolean;
}

interface IndexFile {
  path: string;
  language: string;
  symbols: number;
  mtime: number;
}

interface IndexData {
  version: number;
  root: string;
  indexHead?: string;
  updatedAt: string;
  files: IndexFile[];
  symbols: SymbolRow[];
}

const SOURCE_GLOB = '**/*.{go,ts,tsx,mts,cts,js,jsx,mjs,cjs,py,rs}';

export interface IndexProgress {
  filesScanned: number;
  filesParsed: number;
  symbols: number;
  totalFiles: number;
  note?: string;
}

export async function indexCodebaseTool(
  input: ToolInput,
  cwd: string,
  onProgress?: (progress: IndexProgress) => void
): Promise<Record<string, unknown>> {
  try {
    const root = findGitRoot(cwd) || cwd;
    const maxFiles = asInt(input.max_files ?? input.maxFiles, 0);
    const files = await fg(SOURCE_GLOB, {
      cwd: root,
      onlyFiles: true,
      suppressErrors: true,
      ignore: [...noiseDirs].map(d => `**/${d}/**`)
    });
    const selected = maxFiles > 0 ? files.slice(0, maxFiles) : files;
    const symbols: SymbolRow[] = [];
    const indexedFiles: IndexFile[] = [];
    onProgress?.({filesScanned: 0, filesParsed: 0, symbols: 0, totalFiles: selected.length, note: 'walking'});
    for (let i = 0; i < selected.length; i++) {
      const rel = selected[i]!;
      const abs = path.join(root, rel);
      let raw = '';
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
        if (st.size > 2 * 1024 * 1024) continue;
        raw = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      const lang = languageFor(rel);
      const rows = extractSymbols(rel, lang, raw);
      symbols.push(...rows);
      indexedFiles.push({path: normalizeSlash(rel), language: lang, symbols: rows.length, mtime: Math.floor(st.mtimeMs / 1000)});
      if ((i + 1) % 25 === 0 || i + 1 === selected.length) {
        onProgress?.({
          filesScanned: i + 1,
          filesParsed: indexedFiles.length,
          symbols: symbols.length,
          totalFiles: selected.length,
          note: 'parsing'
        });
      }
    }
    const data: IndexData = {
      version: 1,
      root,
      indexHead: runCapture('git rev-parse --short HEAD', root, 5000),
      updatedAt: new Date().toISOString(),
      files: indexedFiles,
      symbols
    };
    safeWriteFile(indexPath(root), JSON.stringify(data, null, 2), 0o644);
    onProgress?.({
      filesScanned: selected.length,
      filesParsed: indexedFiles.length,
      symbols: symbols.length,
      totalFiles: selected.length,
      note: 'done'
    });
    return {
      ok: true,
      path: indexPath(root),
      scanned: selected.length,
      parsed: indexedFiles.length,
      symbols: symbols.length,
      byLanguage: byLanguage(indexedFiles)
    };
  } catch (err) {
    return errorResult(err);
  }
}

export function searchSymbolsTool(input: ToolInput, cwd: string): Record<string, unknown> {
  const data = loadIndex(cwd);
  if (!data) return {ok: false, error: 'No code index found. Run index_codebase first.'};
  const q = firstString(input, ['query', 'name', 'name_like', 'nameLike']).toLowerCase();
  const kind = firstString(input, ['kind']);
  const file = firstString(input, ['file', 'file_like', 'fileLike']).toLowerCase();
  const limit = asInt(input.limit, 50);
  const symbols = data.symbols.filter(s => {
    if (q && !s.name.toLowerCase().includes(q) && !s.qname.toLowerCase().includes(q)) return false;
    if (kind && s.kind !== kind) return false;
    if (file && !s.file.toLowerCase().includes(file)) return false;
    return true;
  }).slice(0, limit);
  return {ok: true, symbols, count: symbols.length};
}

export function getSnippetTool(input: ToolInput, cwd: string): Record<string, unknown> {
  const data = loadIndex(cwd);
  const qname = firstString(input, ['qname', 'qualifiedName']);
  const name = firstString(input, ['name']);
  const fileInput = firstString(input, ['file', 'path']);
  let row = data?.symbols.find(s => qname && s.qname === qname);
  if (!row && data && name) row = data.symbols.find(s => s.name === name && (!fileInput || s.file.includes(fileInput)));
  const file = row?.file || fileInput;
  if (!file) return {error: 'qname, name, or file is required'};
  try {
    const root = data?.root || findGitRoot(cwd) || cwd;
    const raw = fs.readFileSync(path.join(root, file), 'utf8');
    const lines = raw.split(/\r?\n/);
    const start = Math.max(1, asInt(input.start_line ?? input.startLine, row?.startLine || 1));
    const end = Math.min(lines.length, asInt(input.end_line ?? input.endLine, row?.endLine || start + 80));
    const content = lines.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join('\n');
    return {ok: true, file, startLine: start, endLine: end, content};
  } catch (err) {
    return errorResult(err);
  }
}

export function architectureTool(_input: ToolInput, cwd: string): Record<string, unknown> {
  const data = loadIndex(cwd);
  if (!data) return {ok: false, error: 'No code index found. Run index_codebase first.'};
  const byFile = new Map<string, SymbolRow[]>();
  for (const s of data.symbols) {
    if (!byFile.has(s.file)) byFile.set(s.file, []);
    byFile.get(s.file)!.push(s);
  }
  const hotFiles = [...byFile.entries()]
    .map(([file, symbols]) => ({file, symbols: symbols.length, top: symbols.slice(0, 8).map(s => `${s.kind}:${s.name}`)}))
    .sort((a, b) => b.symbols - a.symbols)
    .slice(0, 25);
  return {ok: true, files: data.files.length, symbols: data.symbols.length, byLanguage: byLanguage(data.files), hotFiles};
}

export function impactTool(input: ToolInput, cwd: string): Record<string, unknown> {
  const data = loadIndex(cwd);
  if (!data) return {ok: false, error: 'No code index found. Run index_codebase first.'};
  const q = firstString(input, ['query', 'name', 'symbol']).toLowerCase();
  if (!q) return {error: 'query/name is required'};
  const hits = data.symbols.filter(s => s.name.toLowerCase().includes(q) || s.qname.toLowerCase().includes(q)).slice(0, 20);
  return {ok: true, query: q, symbols: hits, note: 'TypeScript indexer provides symbol-level impact hints; full call graph parity is still being expanded.'};
}

export function traceCallsTool(input: ToolInput, cwd: string): Record<string, unknown> {
  return impactTool(input, cwd);
}

export function codeOverviewTool(input: ToolInput, cwd: string): Record<string, unknown> {
  return architectureTool(input, cwd);
}

export function tracePathTool(): Record<string, unknown> {
  return {ok: false, error: 'trace_path is not yet available in the TypeScript indexer'};
}

export async function codeDiffTool(_input: ToolInput, cwd: string): Promise<Record<string, unknown>> {
  const {gitDiffTool} = await import('./git-tools.js');
  return await gitDiffTool({stat: true}, cwd);
}

export function verifyImplementationTool(input: ToolInput, cwd: string): Record<string, unknown> {
  const data = loadIndex(cwd);
  if (!data) return {ok: false, error: 'No code index found. Run index_codebase first.'};
  const goal = firstString(input, ['goal', 'query', 'feature']).toLowerCase();
  const terms = goal.split(/[^a-z0-9_]+/).filter(w => w.length > 3).slice(0, 12);
  const hits = data.symbols.filter(s => terms.some(t => s.name.toLowerCase().includes(t) || s.file.toLowerCase().includes(t))).slice(0, 30);
  return {ok: true, goal, likelyWired: hits.length > 0, evidence: hits};
}

function loadIndex(cwd: string): IndexData | null {
  const root = findGitRoot(cwd) || cwd;
  try {
    return JSON.parse(fs.readFileSync(indexPath(root), 'utf8')) as IndexData;
  } catch {
    return null;
  }
}

function indexPath(root: string): string {
  return path.join(root, '.spore-code', 'index.json');
}

function languageFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.go') return 'go';
  if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) return 'ts';
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return 'js';
  if (ext === '.py') return 'py';
  if (ext === '.rs') return 'rs';
  return 'text';
}

function extractSymbols(file: string, language: string, raw: string): SymbolRow[] {
  const rows: SymbolRow[] = [];
  const lines = raw.split(/\r?\n/);
  const patterns: Array<[RegExp, string]> = [
    [/^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, 'function'],
    [/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, 'function'],
    [/^\s*export\s+class\s+([A-Za-z_$][\w$]*)/, 'class'],
    [/^\s*class\s+([A-Za-z_$][\w$]*)/, 'class'],
    [/^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/, 'interface'],
    [/^\s*interface\s+([A-Za-z_$][\w$]*)/, 'interface'],
    [/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/, 'var'],
    [/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/, 'var'],
    [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, 'function'],
    [/^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface|func|\w+)/, 'type'],
    [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, 'function'],
    [/^\s*class\s+([A-Za-z_]\w*)\s*[:(]/, 'class'],
    [/^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(/, 'function'],
    [/^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/, 'struct'],
    [/^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)/, 'enum']
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    for (const [re, kind] of patterns) {
      const m = line.match(re);
      if (!m) continue;
      const name = m[1]!;
      rows.push({
        qname: `${file}::${name}`,
        name,
        kind,
        file,
        startLine: i + 1,
        endLine: findBlockEnd(lines, i),
        signature: truncate(line.trim(), 240),
        language,
        exported: /\bexport\b|\bpub\b|^[A-Z]/.test(line) || /^[A-Z]/.test(name)
      });
      break;
    }
  }
  return rows;
}

function findBlockEnd(lines: string[], start: number): number {
  let depth = 0;
  for (let i = start; i < Math.min(lines.length, start + 300); i++) {
    const line = lines[i] || '';
    for (const c of line) {
      if (c === '{') depth++;
      if (c === '}') depth--;
    }
    if (i > start && depth <= 0 && /^\S/.test(line)) return i;
  }
  return Math.min(lines.length, start + 80);
}

function byLanguage(files: IndexFile[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of files) out[f.language] = (out[f.language] || 0) + 1;
  return out;
}
