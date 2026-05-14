import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {ProjectContext} from './protocol.js';
import {commandExists, findGitRoot, normalizeSlash, projectNameFromRoot, runCapture, truncate, unique} from './util.js';
import {localToolNames} from './tools/executor.js';

const NOISE_DIRS = new Set([
  '.git', 'node_modules', '.venv', 'venv', 'env', '__pycache__', 'dist', 'build',
  'target', 'out', '.next', '.cache', '.spore-code', 'vendor', '.gradle', '.mvn',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.turbo', '.nuxt', '.svelte-kit',
  '.terraform', '.idea', '.vscode', 'coverage', '.nyc_output'
]);

export function buildProjectContext(cwd: string, mode: 'plan' | 'execute', scope: 'strict' | 'expanded' | '' = ''): ProjectContext {
  const gitRoot = findGitRoot(cwd);
  const root = gitRoot || cwd;
  const pc: ProjectContext = {
    cwd,
    project: projectNameFromRoot(root),
    mode,
    scope,
    os: platformName(),
    arch: os.arch(),
    ...shellContext(),
    pathSeparator: path.sep,
    pathListSeparator: path.delimiter,
    localTools: localToolNames(),
    toolGuidance: codeLookupToolGuidance(hasCodeIndex(root))
  };
  if (gitRoot) {
    pc.gitBranch = runCapture('git branch --show-current', gitRoot, 5000);
    pc.gitHash = runCapture('git rev-parse --short HEAD', gitRoot, 5000);
    const status = runCapture('git status --short', gitRoot, 5000);
    if (status) pc.gitStatus = truncate(status, 1024);
  }
  const type = detectProjectType(root);
  if (type) pc.projectType = type;
  const sporeMd = path.join(root, 'SPORE.md');
  if (fs.existsSync(sporeMd)) pc.sporeMd = truncate(fs.readFileSync(sporeMd, 'utf8'), 4096);
  pc.tree = projectTree(root, 2, 100);
  pc.tools = detectTools();
  const idx = readIndexMeta(root);
  if (idx.files > 0) {
    pc.hasCodeIndex = true;
    pc.indexHead = idx.indexHead;
  }
  pc.hardware = detectHardware();
  return pc;
}

function platformName(): string {
  if (process.platform === 'win32') return 'windows';
  return process.platform;
}

function shellContext(): Pick<ProjectContext, 'defaultShell' | 'shellFlag' | 'shellFamily' | 'availableShells'> {
  if (process.platform === 'win32') {
    const shells = ['cmd.exe', 'powershell.exe', 'pwsh.exe', 'bash.exe'].filter(commandExists);
    return {
      defaultShell: process.env.ComSpec || 'cmd.exe',
      shellFlag: '/C',
      shellFamily: 'cmd',
      availableShells: shells.length ? shells : ['cmd.exe']
    };
  }
  const shells = ['sh', 'bash', 'zsh', 'fish'].filter(commandExists);
  return {
    defaultShell: process.env.SHELL || 'sh',
    shellFlag: '-c',
    shellFamily: 'sh',
    availableShells: shells.length ? shells : ['sh']
  };
}

function detectProjectType(root: string): string {
  const has = (file: string) => fs.existsSync(path.join(root, file));
  if (has('package.json')) return 'Node.js';
  if (has('go.mod')) return 'Go';
  if (has('pyproject.toml') || has('requirements.txt')) return 'Python';
  if (has('Cargo.toml')) return 'Rust';
  if (has('pom.xml') || has('build.gradle')) return 'Java';
  return '';
}

function projectTree(root: string, maxDepth: number, maxEntries: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > maxDepth || out.length >= maxEntries) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, {withFileTypes: true});
    } catch {
      return;
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (out.length >= maxEntries) return;
      if (ent.name.startsWith('.') && ent.name !== '.env' && ent.name !== '.gitignore') continue;
      if (ent.isDirectory() && NOISE_DIRS.has(ent.name)) continue;
      const child = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        out.push(`${child}/`);
        walk(path.join(dir, ent.name), child, depth + 1);
      } else {
        out.push(child);
      }
    }
  };
  walk(root, '', 1);
  return out;
}

function detectTools(): string[] {
  return ['git', 'node', 'npm', 'pnpm', 'yarn', 'bun', 'go', 'python', 'python3', 'cargo', 'rustc', 'docker']
    .filter(commandExists);
}

function detectHardware(): ProjectContext['hardware'] {
  const hw = {
    kernel: os.type() + ' ' + os.release(),
    cpuModel: os.cpus()[0]?.model || '',
    cpuCores: os.cpus().length,
    ramGi: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    gpu: [] as string[]
  };
  if (process.platform !== 'win32' && commandExists('nvidia-smi')) {
    const gpu = runCapture('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', process.cwd(), 3000);
    if (gpu) hw.gpu = gpu.split(/\r?\n/).slice(0, 4);
  }
  return hw;
}

function hasCodeIndex(root: string): boolean {
  return readIndexMeta(root).files > 0;
}

function readIndexMeta(root: string): {files: number; indexHead?: string} {
  try {
    const raw = fs.readFileSync(path.join(root, '.spore-code', 'index.json'), 'utf8');
    const parsed = JSON.parse(raw) as {files?: unknown[]; indexHead?: string};
    return {files: Array.isArray(parsed.files) ? parsed.files.length : 0, indexHead: parsed.indexHead};
  } catch {
    return {files: 0};
  }
}

function codeLookupToolGuidance(hasIndex: boolean): string[] {
  const guidance = [
    'Prefer targeted code lookup over full-file reads.',
    'Use search_symbols to find qname/file/start/end, then get_snippet with qname or name+file/kind.',
    'Use get_snippet with file+start_line/end_line or read_file with start_line/end_line for narrow ranges.',
    'Only read whole files when symbol/range lookup cannot answer the question.'
  ];
  if (!hasIndex) guidance.push('If structural lookup is empty, run index_codebase first or rely on grep/read_file ranges.');
  return unique(guidance);
}

export {NOISE_DIRS};
