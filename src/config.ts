import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import type {SporeConfig} from './protocol.js';
import {ensureDir, homeSporeDir, safeWriteFile} from './util.js';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 18810;

export class NoGlobalConfigError extends Error {
  constructor() {
    super('no global config');
  }
}

export function defaultConfig(cwd: string): SporeConfig {
  const globalDir = homeSporeDir();
  return {
    connection: {
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      user: os.userInfo().username || 'user',
      auth_method: 'device',
      key: '',
      password: '',
      device_id: ''
    },
    display: {
      theme: 'dark',
      show_thinking: true,
      show_tools: true,
      show_usage: true
    },
    session: {
      auto_resume: false
    },
    globalDir,
    localDir: path.join(cwd, '.spore-code')
  };
}

export function cloneConfig(cfg: SporeConfig): SporeConfig {
  return {
    connection: {...cfg.connection},
    display: {...cfg.display},
    session: {...cfg.session},
    globalDir: cfg.globalDir,
    localDir: cfg.localDir
  };
}

export function loadConfig(cwd: string): SporeConfig {
  const cfg = defaultConfig(cwd);
  const globalPath = path.join(cfg.globalDir, 'config.toml');
  if (!fs.existsSync(globalPath)) throw new NoGlobalConfigError();
  mergeTomlFile(globalPath, cfg);
  const localPath = path.join(cfg.localDir, 'config.toml');
  if (fs.existsSync(localPath)) mergeTomlFile(localPath, cfg);
  return cfg;
}

export function loadGlobalConfig(): SporeConfig {
  const cfg = defaultConfig(process.cwd());
  const globalPath = path.join(cfg.globalDir, 'config.toml');
  if (!fs.existsSync(globalPath)) throw new NoGlobalConfigError();
  mergeTomlFile(globalPath, cfg);
  return cfg;
}

export function saveConfig(cfg: SporeConfig): void {
  const content = `[connection]
host = ${q(cfg.connection.host)}
port = ${Number(cfg.connection.port || DEFAULT_PORT)}
user = ${q(cfg.connection.user)}
auth_method = ${q(cfg.connection.auth_method || 'device')}
key = ${q(cfg.connection.key || '')}
password = ${q(cfg.connection.password || '')}
device_id = ${q(cfg.connection.device_id || '')}

[display]
theme = ${q(cfg.display.theme || 'dark')}
show_thinking = ${bool(cfg.display.show_thinking, true)}
show_tools = ${bool(cfg.display.show_tools, true)}
show_usage = ${bool(cfg.display.show_usage, true)}

[session]
auto_resume = ${bool(cfg.session.auto_resume, false)}
`;
  safeWriteFile(path.join(cfg.globalDir, 'config.toml'), content, 0o600);
}

export function ensureProjectDirs(cwd: string): void {
  ensureDir(path.join(cwd, '.spore-code', 'plans'));
  ensureDir(path.join(cwd, '.spore-code', 'logs'));
  ensureDir(path.join(cwd, '.spore-code', 'scratch'));
}

export function deviceTokenKey(cfg: SporeConfig): string {
  return `${cfg.connection.host}:${cfg.connection.port}:${cfg.connection.user}`;
}

export function loadDeviceToken(cfg: SporeConfig): string {
  const file = path.join(cfg.globalDir, 'device_tokens.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
    return parsed[deviceTokenKey(cfg)] || '';
  } catch {
    return '';
  }
}

export function saveDeviceToken(cfg: SporeConfig, token: string): void {
  const file = path.join(cfg.globalDir, 'device_tokens.json');
  let parsed: Record<string, string> = {};
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
  } catch {
    parsed = {};
  }
  parsed[deviceTokenKey(cfg)] = token;
  safeWriteFile(file, JSON.stringify(parsed, null, 2), 0o600);
}

export function deleteDeviceToken(cfg: SporeConfig): void {
  const file = path.join(cfg.globalDir, 'device_tokens.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
    delete parsed[deviceTokenKey(cfg)];
    safeWriteFile(file, JSON.stringify(parsed, null, 2), 0o600);
  } catch {
    // Nothing to remove.
  }
}

export function resetAuth(cfg: SporeConfig): void {
  deleteDeviceToken(cfg);
  cfg.connection.auth_method = 'device';
  cfg.connection.key = '';
  cfg.connection.password = '';
  cfg.connection.device_id = '';
}

export function authReady(cfg: SporeConfig): boolean {
  switch (cfg.connection.auth_method) {
    case 'device':
      return Boolean(loadDeviceToken(cfg));
    case 'password':
      return Boolean(cfg.connection.password);
    case 'invite':
      return Boolean(cfg.connection.key);
    default:
      return false;
  }
}

export function authMissingReason(cfg: SporeConfig): string {
  switch (cfg.connection.auth_method) {
    case 'device':
      return 'missing device token';
    case 'password':
      return 'missing account password';
    case 'invite':
      return 'missing invite key';
    default:
      return `unsupported auth method: ${String(cfg.connection.auth_method)}`;
  }
}

export function saveLastSession(cfg: SporeConfig, sessionId: string, cwd: string): void {
  safeWriteFile(path.join(cfg.globalDir, 'last_session'), `session_id = ${q(sessionId)}\ncwd = ${q(cwd)}\n`, 0o600);
}

export function loadLastSession(cfg: SporeConfig): {sessionId: string; cwd: string} | null {
  try {
    const raw = fs.readFileSync(path.join(cfg.globalDir, 'last_session'), 'utf8');
    const parsed = parseToml(raw);
    return {sessionId: String(parsed.session_id || ''), cwd: String(parsed.cwd || '')};
  } catch {
    return null;
  }
}

export async function runSetupWizard(cwd: string, base?: SporeConfig): Promise<SporeConfig> {
  const cfg = base ? cloneConfig(base) : defaultConfig(cwd);
  const host = await promptText(`Spore Core host [${cfg.connection.host}]: `);
  const port = await promptText(`Spore Core port [${cfg.connection.port}]: `);
  const user = await promptText(`Username [${cfg.connection.user}]: `);
  const method = (await promptText('Auth method: invite or password [password]: ')).trim().toLowerCase();
  cfg.connection.host = host.trim() || cfg.connection.host;
  cfg.connection.port = Number(port.trim() || cfg.connection.port);
  cfg.connection.user = user.trim() || cfg.connection.user;
  if (method === 'invite') {
    cfg.connection.auth_method = 'invite';
    cfg.connection.key = await promptSecret('Invite key: ');
  } else {
    cfg.connection.auth_method = 'password';
    cfg.connection.password = await promptSecret('Password: ');
  }
  const theme = await promptText(`Theme [${cfg.display.theme}]: `);
  cfg.display.theme = theme.trim() || cfg.display.theme;
  saveConfig(cfg);
  return cfg;
}

async function promptText(prompt: string): Promise<string> {
  const rl = readline.createInterface({input, output});
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

async function promptSecret(prompt: string): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    return await promptText(prompt);
  }
  return await new Promise<string>((resolve, reject) => {
    const chars: string[] = [];
    const wasRaw = input.isRaw;

    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(wasRaw);
      output.write('\n');
    };
    const finish = () => {
      cleanup();
      resolve(chars.join(''));
    };
    const cancel = () => {
      cleanup();
      reject(new Error('setup cancelled'));
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') {
          cancel();
          return;
        }
        if (char === '\r' || char === '\n') {
          finish();
          return;
        }
        if (char === '\u0008' || char === '\u007f') {
          if (chars.length) {
            chars.pop();
            output.write('\b \b');
          }
          continue;
        }
        if (char >= ' ') {
          chars.push(char);
          output.write('*');
        }
      }
    };

    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

function mergeTomlFile(file: string, cfg: SporeConfig): void {
  const parsed = parseToml(fs.readFileSync(file, 'utf8'));
  if (parsed.connection && typeof parsed.connection === 'object') {
    Object.assign(cfg.connection, parsed.connection);
  }
  if (parsed.display && typeof parsed.display === 'object') {
    Object.assign(cfg.display, parsed.display);
  }
  if (parsed.session && typeof parsed.session === 'object') {
    Object.assign(cfg.session, parsed.session);
  }
}

export function parseToml(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let section: Record<string, unknown> = out;
  for (const original of raw.split(/\r?\n/)) {
    const line = stripComment(original).trim();
    if (!line) continue;
    const header = line.match(/^\[([A-Za-z0-9_.-]+)]$/);
    if (header) {
      const name = header[1]!;
      if (!out[name] || typeof out[name] !== 'object') out[name] = {};
      section = out[name] as Record<string, unknown>;
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    section[key] = parseTomlValue(line.slice(eq + 1).trim());
  }
  return out;
}

function parseTomlValue(value: string): unknown {
  if (/^".*"$/.test(value)) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function stripComment(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== '\\') quoted = !quoted;
    if (c === '#' && !quoted) return line.slice(0, i);
  }
  return line;
}

function q(v: string): string {
  return `"${String(v || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function bool(v: unknown, fallback: boolean): string {
  return String(typeof v === 'boolean' ? v : fallback);
}
