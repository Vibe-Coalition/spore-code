import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import fg from 'fast-glob';
import {asBool, asInt, errorResult, firstString, noiseDirs, readText, resolvePath, stringList, type ToolInput} from './common.js';

export function readFileTool(input: ToolInput, cwd: string, scope: string): Record<string, unknown> {
  try {
    const file = resolvePath(firstString(input, ['path', 'file', 'file_path', 'filePath', 'filename']), cwd, scope);
    const raw = readText(file);
    const lines = raw.split(/\r?\n/);
    const {offset, limit, includeLineNumbers} = readOptions(input);
    const start = offset < 0 ? Math.max(0, lines.length + offset) : Math.min(offset, lines.length);
    const end = Math.min(lines.length, start + limit);
    const selected = lines.slice(start, end);
    const content = selected.map((line, i) => includeLineNumbers ? `${start + i + 1}\t${line}` : line).join('\n');
    return {content, totalLines: lines.length, firstLine: start + 1};
  } catch (err) {
    return errorResult(err);
  }
}

export function writeFileTool(input: ToolInput, cwd: string, scope: string): Record<string, unknown> {
  try {
    const file = resolvePath(firstString(input, ['path', 'file', 'file_path', 'filePath', 'filename']), cwd, scope);
    const content = firstString(input, ['content', 'text', 'contents', 'body', 'data']);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, content, 'utf8');
    return {ok: true, path: file, bytes: Buffer.byteLength(content)};
  } catch (err) {
    return errorResult(err);
  }
}

export function editFileTool(input: ToolInput, cwd: string, scope: string): Record<string, unknown> {
  try {
    const file = resolvePath(firstString(input, ['path', 'file', 'file_path', 'filePath', 'filename']), cwd, scope);
    const oldText = firstString(input, ['old_string', 'old_text', 'oldString', 'old', 'find', 'search']);
    const newText = firstString(input, ['new_string', 'new_text', 'newString', 'new', 'replace', 'replacement']);
    if (!oldText) throw new Error('old_string is required');
    const raw = readText(file);
    const replaceAll = asBool(input.replace_all ?? input.replaceAll, false);
    const oldVariants = candidateLineEndings(oldText, raw);
    let matchedOld = '';
    for (const v of oldVariants) {
      if (raw.includes(v)) {
        matchedOld = v;
        break;
      }
    }
    if (!matchedOld) throw new Error('old_string not found');
    const replacement = lineEndingFor(newText, matchedOld);
    const count = replaceAll ? countOccurrences(raw, matchedOld) : 1;
    const next = replaceAll
      ? raw.split(matchedOld).join(replacement)
      : raw.replace(matchedOld, replacement);
    fs.writeFileSync(file, next, 'utf8');
    return {ok: true, path: file, replacements: count};
  } catch (err) {
    return errorResult(err);
  }
}

export function patchFileTool(input: ToolInput, cwd: string, scope: string): Record<string, unknown> {
  try {
    const patch = firstString(input, ['patch', 'diff', 'unified_diff', 'unifiedDiff']);
    if (!patch.trim()) throw new Error('patch is required');
    const paths = patchPaths(patch);
    for (const p of paths) resolvePath(p, cwd, scope);
    const tmp = path.join(os.tmpdir(), `spore-patch-${process.pid}-${Date.now()}.diff`);
    fs.writeFileSync(tmp, patch, 'utf8');
    try {
      const check = spawnSync('git', ['apply', '--check', tmp], {cwd, encoding: 'utf8', windowsHide: true});
      if (check.status !== 0) {
        return {ok: false, error: `git apply --check failed`, output: `${check.stdout || ''}${check.stderr || ''}`.trim(), paths};
      }
      const apply = spawnSync('git', ['apply', tmp], {cwd, encoding: 'utf8', windowsHide: true});
      if (apply.status !== 0) {
        return {ok: false, error: `git apply failed`, output: `${apply.stdout || ''}${apply.stderr || ''}`.trim(), paths};
      }
      return {ok: true, paths, output: `${apply.stdout || ''}${apply.stderr || ''}`.trim()};
    } finally {
      try { fs.unlinkSync(tmp); } catch {}
    }
  } catch (err) {
    return errorResult(err);
  }
}

export async function globTool(input: ToolInput, cwd: string, scope = ''): Promise<Record<string, unknown>> {
  try {
    const pattern = firstString(input, ['pattern', 'glob', 'query'], '**/*');
    const root = resolvePath(firstString(input, ['path', 'dir', 'directory', 'folder', 'cwd'], '.'), cwd, scope);
    validateScopedGlob(pattern, scope);
    const max = asInt(input.limit ?? input.max ?? input.max_results, 500);
    const includeHidden = asBool(input.include_hidden ?? input.dot, false);
    const entries = await fg(pattern, {
      cwd: root,
      dot: includeHidden,
      onlyFiles: false,
      unique: true,
      suppressErrors: true,
      ignore: [...noiseDirs].map(d => `**/${d}/**`)
    });
    return {ok: true, path: root, matches: entries.slice(0, max), count: entries.length, truncated: entries.length > max};
  } catch (err) {
    return errorResult(err);
  }
}

export async function grepTool(input: ToolInput, cwd: string, scope = ''): Promise<Record<string, unknown>> {
  try {
    const query = firstString(input, ['query', 'pattern', 'text', 'regex']);
    if (!query) return {error: 'query is required'};
    const root = resolvePath(firstString(input, ['path', 'dir', 'directory', 'folder', 'cwd'], '.'), cwd, scope);
    const fileGlob = firstString(input, ['glob', 'files'], '**/*.{ts,tsx,js,jsx,mjs,cjs,go,py,rs,md,json,toml,yml,yaml,css,html}');
    validateScopedGlob(fileGlob, scope);
    const regexMode = asBool(input.regex, false);
    const insensitive = asBool(input.ignore_case ?? input.ignoreCase, true);
    const re = regexMode ? new RegExp(query, insensitive ? 'i' : '') : null;
    const files = await fg(fileGlob, {
      cwd: root,
      onlyFiles: true,
      suppressErrors: true,
      ignore: [...noiseDirs].map(d => `**/${d}/**`)
    });
    const max = asInt(input.limit ?? input.max_results, 200);
    const matches: Array<Record<string, unknown>> = [];
    const needle = insensitive ? query.toLowerCase() : query;
    for (const file of files) {
      if (matches.length >= max) break;
      let raw = '';
      try { raw = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
      const lines = raw.split(/\r?\n/);
      for (let i = 0; i < lines.length && matches.length < max; i++) {
        const line = lines[i] || '';
        const hit = re ? re.test(line) : (insensitive ? line.toLowerCase() : line).includes(needle);
        if (hit) matches.push({file, line: i + 1, text: line.slice(0, 500)});
      }
    }
    return {ok: true, path: root, matches, count: matches.length, truncated: matches.length >= max};
  } catch (err) {
    return errorResult(err);
  }
}

export function listDirTool(input: ToolInput, cwd: string, scope: string): Record<string, unknown> {
  try {
    const dir = resolvePath(firstString(input, ['path', 'dir', 'directory', 'folder', 'cwd'], '.'), cwd, scope);
    const includeHidden = asBool(input.include_hidden, false);
    const max = asInt(input.max_entries, 200);
    const entries = fs.readdirSync(dir, {withFileTypes: true})
      .filter(e => includeHidden || (!e.name.startsWith('.') && !noiseDirs.has(e.name)))
      .map(e => {
        const st = fs.statSync(path.join(dir, e.name));
        return {name: e.name, path: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other', size: st.size, mtime: st.mtime.toISOString()};
      })
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    return {ok: true, path: dir, entries: entries.slice(0, max), count: entries.length, truncated: entries.length > max};
  } catch (err) {
    return errorResult(err);
  }
}

export function readManyFilesTool(input: ToolInput, cwd: string, scope: string): Record<string, unknown> {
  const paths = stringList(input.paths ?? input.files ?? input.file_paths ?? input.filePaths).slice(0, 20);
  if (!paths.length) return {error: 'paths is required'};
  return {ok: true, files: paths.map(p => ({path: p, result: readFileTool({...input, path: p, limit: input.limit ?? 400}, cwd, scope)})), count: paths.length};
}

function readOptions(input: ToolInput): {offset: number; limit: number; includeLineNumbers: boolean} {
  let offset = asInt(input.offset, 0);
  let limit = asInt(input.limit, 2000);
  const start = asInt(input.start_line ?? input.startLine, 0);
  const end = asInt(input.end_line ?? input.endLine, 0);
  if (start > 0) {
    offset = start - 1;
    if (end >= start) limit = end - start + 1;
  }
  if (limit <= 0) limit = 2000;
  return {offset, limit, includeLineNumbers: !asBool(input.compact ?? input.code_only ?? input.codeOnly, false)};
}

function candidateLineEndings(needle: string, haystack: string): string[] {
  const eol = haystack.includes('\r\n') ? '\r\n' : '\n';
  const normalized = needle.replace(/\r\n/g, '\n');
  const variants = [needle, normalized, normalized.replace(/\n/g, eol)];
  return [...new Set(variants)];
}

function lineEndingFor(text: string, matchedOld: string): string {
  if (matchedOld.includes('\r\n')) return text.replace(/\r?\n/g, '\r\n');
  if (matchedOld.includes('\n')) return text.replace(/\r\n/g, '\n');
  return text;
}

function countOccurrences(raw: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = raw.indexOf(needle, idx)) >= 0) {
    count++;
    idx += needle.length;
  }
  return count;
}

function patchPaths(diff: string): string[] {
  const seen = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    if (!line.startsWith('--- ') && !line.startsWith('+++ ')) continue;
    const raw = line.slice(4).trim().split(/\s+/)[0] || '';
    if (!raw || raw === '/dev/null') continue;
    const name = raw.replace(/^[ab]\//, '');
    if (path.isAbsolute(name)) throw new Error(`unsafe absolute patch path: ${name}`);
    if (name.split(/[\\/]/).includes('..')) throw new Error(`unsafe patch path: ${name}`);
    seen.add(name);
  }
  return [...seen];
}

function validateScopedGlob(pattern: string, scope: string): void {
  if (scope === 'expanded') return;
  const parts = pattern.split(/[\\/]+/).filter(Boolean);
  if (path.isAbsolute(pattern) || path.win32.isAbsolute(pattern) || parts.includes('..')) {
    throw new Error(`glob pattern ${pattern} is outside the working directory (use /scope expanded to broaden)`);
  }
}
