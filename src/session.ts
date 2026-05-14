import fs from 'node:fs';
import path from 'node:path';
import type {ChatMessage, SporeConfig} from './protocol.js';
import {findGitRoot, projectNameFromRoot, safeSessionId, safeWriteFile, sha256Short, timestampId} from './util.js';

export function computeSessionId(user: string, cwd: string, fresh = true): string {
  const root = findGitRoot(cwd) || cwd;
  const project = projectNameFromRoot(root).replace(/[^A-Za-z0-9_.-]/g, '_');
  const base = `cli:${user}@${project}-${sha256Short(root, 8)}`;
  return fresh ? `${base}-${timestampId()}` : base;
}

export interface LastSessionPointer {
  sessionId: string;
  cwd: string;
}

export interface ProjectSessionInfo {
  sessionId: string;
  file: string;
  messageCount: number;
  preview: string;
  updatedAt: number;
}

export interface SessionResolution {
  sessionId: string;
  isContinue: boolean;
  source: 'explicit' | 'project-last' | 'global-last' | 'deterministic' | 'fresh';
}

export function resolveSessionId(user: string, cwd: string, opts: {
  explicitSessionId?: string;
  continueRequested?: boolean;
  autoResume?: boolean;
  globalLast?: LastSessionPointer | null;
} = {}): SessionResolution {
  if (opts.explicitSessionId) {
    return {sessionId: opts.explicitSessionId, isContinue: true, source: 'explicit'};
  }

  const shouldResume = Boolean(opts.continueRequested || opts.autoResume);
  if (shouldResume) {
    const projectLast = loadProjectLastSession(cwd);
    if (projectLast) {
      return {sessionId: projectLast, isContinue: true, source: 'project-last'};
    }
    if (opts.globalLast?.sessionId && samePath(opts.globalLast.cwd, cwd)) {
      return {sessionId: opts.globalLast.sessionId, isContinue: true, source: 'global-last'};
    }
    return {sessionId: computeSessionId(user, cwd, false), isContinue: true, source: 'deterministic'};
  }

  return {sessionId: computeSessionId(user, cwd, true), isContinue: false, source: 'fresh'};
}

export function saveProjectLastSession(cwd: string, sessionId: string): void {
  const pointer: LastSessionPointer = {sessionId, cwd: path.resolve(cwd)};
  safeWriteFile(projectLastSessionFile(cwd), `${JSON.stringify(pointer, null, 2)}\n`, 0o600);
}

export function loadProjectLastSession(cwd: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(projectLastSessionFile(cwd), 'utf8')) as Partial<LastSessionPointer>;
    return typeof parsed.sessionId === 'string' ? parsed.sessionId : '';
  } catch {
    return '';
  }
}

export function listProjectSessions(cfg: SporeConfig, cwd: string, limit = 20): ProjectSessionInfo[] {
  const dir = path.join(cfg.globalDir, 'sessions');
  const prefix = safeSessionId(computeSessionId(cfg.connection.user, cwd, false));
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter(file => file.endsWith('.jsonl') && file.startsWith(prefix));
  } catch {
    return [];
  }
  const rows = files.map(file => readProjectSessionFile(path.join(dir, file))).filter(Boolean) as ProjectSessionInfo[];
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows.slice(0, limit);
}

function readProjectSessionFile(file: string): ProjectSessionInfo | null {
  try {
    const st = fs.statSync(file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    let sessionId = '';
    let messageCount = 0;
    let preview = '';
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed._meta && typeof parsed.session_id === 'string') {
        sessionId = parsed.session_id;
        continue;
      }
      const role = String(parsed.role || '');
      const text = String(parsed.text || '').trim();
      if (role === 'user' || role === 'assistant') {
        messageCount++;
        if (text) preview = text.replace(/\s+/g, ' ').slice(0, 90);
      }
    }
    return {
      sessionId: sessionId || path.basename(file, '.jsonl'),
      file,
      messageCount,
      preview,
      updatedAt: st.mtimeMs
    };
  } catch {
    return null;
  }
}

function projectLastSessionFile(cwd: string): string {
  return path.join(cwd, '.spore-code', 'last_session.json');
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

export class SessionLog {
  private readonly file: string;

  constructor(cfg: SporeConfig, private readonly sessionId: string) {
    this.file = path.join(cfg.globalDir, 'sessions', `${safeSessionId(sessionId)}.jsonl`);
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    if (!fs.existsSync(this.file)) {
      this.append({_meta: true, session_id: sessionId, created: Date.now() / 1000});
    }
  }

  path(): string {
    return this.file;
  }

  writeMessage(message: ChatMessage): void {
    this.append({
      role: message.role,
      text: message.text,
      ts: message.timestamp / 1000
    });
  }

  writeAssistant(text: string, extra: Record<string, unknown> = {}): void {
    this.append({role: 'assistant', text, ...extra});
  }

  writeTool(name: string, input: unknown, result: unknown, local: boolean, ms: number): void {
    this.append({
      role: 'tool',
      name,
      input: truncateJson(input, 500),
      result_preview: truncateJson(result, 500),
      local,
      ms
    });
  }

  load(): ChatMessage[] {
    try {
      const rows = fs.readFileSync(this.file, 'utf8').split(/\r?\n/).filter(Boolean);
      const out: ChatMessage[] = [];
      for (const row of rows) {
        const parsed = JSON.parse(row) as Record<string, unknown>;
        if (parsed._meta) continue;
        const role = String(parsed.role || '') as ChatMessage['role'];
        const text = String(parsed.text || '');
        if (!text || !['user', 'assistant', 'system', 'tool', 'error'].includes(role)) continue;
        out.push({role, text, timestamp: Number(parsed.ts || Date.now() / 1000) * 1000});
      }
      return out;
    } catch {
      return [];
    }
  }

  private append(record: Record<string, unknown>): void {
    const line = JSON.stringify({ts: Date.now() / 1000, ...record});
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    fs.appendFileSync(this.file, `${line}\n`);
  }
}

export function writeDebugLog(cfg: SporeConfig, sessionId: string, line: string): void {
  const file = path.join(cfg.globalDir, 'logs', `${safeSessionId(sessionId)}.log`);
  const next = `[${new Date().toISOString()}] ${line}\n`;
  if (fs.existsSync(file)) fs.appendFileSync(file, next);
  else safeWriteFile(file, next, 0o600);
}

export function saveApprovedPlan(cwd: string, text: string, d = new Date()): string {
  const file = path.join(cwd, '.spore-code', 'plans', `plan-${timestampId(d)}.md`);
  const body = `# Approved Plan\n\nSaved: ${d.toISOString()}\n\n${text.trim()}\n`;
  safeWriteFile(file, body, 0o600);
  return file;
}

function truncateJson(value: unknown, max: number): string {
  const raw = JSON.stringify(value);
  return raw.length > max ? `${raw.slice(0, max)}...` : raw;
}
