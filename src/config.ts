import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import {URL} from 'node:url';
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
  output.write('\n');
  output.write('╔════════════════════════════════════════╗\n');
  output.write('║  Spore Code — first-time setup        ║\n');
  output.write('╚════════════════════════════════════════╝\n\n');

  output.write('1. Connect to Spore Core\n');
  output.write('   Enter your Spore Core server address.\n');
  output.write('   Examples: 192.168.1.10 · https://spore.example.com\n');
  let {host, port} = await promptEndpoint(cfg.connection.host, cfg.connection.port || DEFAULT_PORT);
  output.write('\n');

  output.write('2. Your identity\n');
  output.write('   Choose a username — the agent will remember you by this name.\n');
  let user = '';
  while (!user) {
    user = cleanPromptLine(await promptText(`   Username [${cfg.connection.user}]: `)) || cfg.connection.user;
    if (!user) output.write('   Username is required.\n');
  }
  output.write('\n');

  output.write('3. Authentication\n');
  output.write('   Paste either your invite key or your Spore account password.\n');
  let secret = await promptLoginSecret('');
  output.write('\n');

  let auth: AuthAttempt | null = null;
  for (;;) {
    output.write('4. Testing connection...\n');
    try {
      auth = await testAuthAuto(host, port, user, secret);
      if (!auth.deviceToken) throw new Error('server authenticated but did not issue a device token; update Spore Core and retry');
      output.write('   OK Connected and authenticated successfully.\n');
      break;
    } catch (err) {
      output.write(`   ERR ${err instanceof Error ? err.message : String(err)}\n`);
      const retry = await promptConfirm('   Edit details and retry?', true);
      if (!retry) throw new Error('setup aborted');
      const next = await promptEndpoint(host, port);
      host = next.host;
      port = next.port;
      for (;;) {
        const nextUser = cleanPromptLine(await promptText(`   Username [${user}]: `)) || user;
        if (nextUser) {
          user = nextUser;
          break;
        }
        output.write('   Username is required.\n');
      }
      secret = await promptLoginSecret(secret);
      output.write('\n');
    }
  }
  output.write('\n');

  output.write('5. Choose a theme\n');
  output.write('   dark    purple/cyan terminal theme\n');
  output.write('   oled    high contrast black terminal theme\n');
  output.write('   light   orange-accent light terminal theme\n');
  const theme = cleanPromptLine(await promptText(`   Theme [${cfg.display.theme || 'dark'}]: `)) || cfg.display.theme || 'dark';
  cfg.display.theme = ['dark', 'oled', 'light'].includes(theme) ? theme : 'dark';

  cfg.connection.host = host;
  cfg.connection.port = port;
  cfg.connection.user = user;
  cfg.connection.auth_method = 'device';
  cfg.connection.key = '';
  cfg.connection.password = '';
  cfg.connection.device_id = auth?.deviceId || '';
  if (auth?.deviceToken) saveDeviceToken(cfg, auth.deviceToken);
  saveConfig(cfg);
  output.write(`\n   OK Saved to ${path.join(cfg.globalDir, 'config.toml')}\n\n`);
  return cfg;
}

async function promptEndpoint(defaultHost: string, defaultPort: number): Promise<{host: string; port: number}> {
  const host = cleanPromptLine(await promptText(`   Host [${defaultHost}]: `)) || defaultHost;
  let port = defaultPort;
  if (!host.includes('://')) {
    const portText = cleanPromptLine(await promptText(`   Port [${defaultPort}]: `));
    const parsed = Number(portText || defaultPort);
    if (Number.isInteger(parsed) && parsed > 0) port = parsed;
  }
  return {host, port};
}

async function promptLoginSecret(existing: string): Promise<string> {
  for (;;) {
    const label = existing
      ? '   Invite key or account password [keep existing; paste replacement or enter to keep]: '
      : '   Invite key or account password: ';
    const secret = cleanPromptLine(await promptSecret(label)).trim();
    if (secret) return secret;
    if (existing) return existing;
    output.write('   Invite key or account password is required.\n');
  }
}

async function promptConfirm(label: string, fallback: boolean): Promise<boolean> {
  const suffix = fallback ? '[Y/n]' : '[y/N]';
  const raw = (await promptText(`${label} ${suffix}: `)).trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'y' || raw === 'yes';
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

function cleanPromptLine(line: string): string {
  return String(line || '')
    .replace(/\x1b\[200~/g, '')
    .replace(/\x1b\[201~/g, '')
    .replace(/[\r\n]+$/g, '');
}

interface AuthAttempt {
  method: 'password' | 'invite';
  deviceToken: string;
  deviceId: string;
}

async function testAuthAuto(host: string, port: number, user: string, secret: string): Promise<AuthAttempt> {
  const cleaned = secret.trim();
  if (!cleaned) throw new Error('invite key or account password is required');
  let passwordErr: unknown;
  try {
    return await testAuth(host, port, user, 'password', '', cleaned);
  } catch (err) {
    passwordErr = err;
  }
  try {
    return await testAuth(host, port, user, 'invite', cleaned, '');
  } catch (inviteErr) {
    throw new Error(`account password failed (${errorMessage(passwordErr)}); invite key failed (${errorMessage(inviteErr)})`);
  }
}

async function testAuth(host: string, port: number, user: string, method: 'password' | 'invite', key: string, password: string): Promise<AuthAttempt> {
  const base = endpointBase(host, port);
  if (!setupAuthTransportAllowed(base)) {
    throw new Error(`refusing to send credentials over insecure HTTP to ${base} (use HTTPS, localhost/private LAN, or SPORE_CODE_ALLOW_INSECURE_AUTH=true)`);
  }
  const body = method === 'password'
    ? {username: user, authMethod: 'password', password, issueDevice: true}
    : {username: user, key, issueDevice: true};
  const res = await postJson(new URL('/api/spore-code/auth', base), body);
  return {
    method,
    deviceToken: typeof res.deviceToken === 'string' ? res.deviceToken : '',
    deviceId: typeof res.deviceId === 'string' ? res.deviceId : ''
  };
}

function endpointBase(host: string, port: number): string {
  const raw = host.includes('://') ? host : `http://${host}:${port}`;
  return raw.replace(/\/+$/, '');
}

function setupAuthTransportAllowed(base: string): boolean {
  const u = new URL(base);
  if (u.protocol === 'https:') return true;
  const host = u.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (net.isIP(host)) {
    const ip = net.isIP(host) ? host : '';
    if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('169.254.')) return true;
    const parts = ip.split('.').map(Number);
    if (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) return true;
  }
  return /^(1|true|yes)$/i.test(process.env.SPORE_CODE_ALLOW_INSECURE_AUTH || '');
}

async function postJson(url: URL, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const raw = JSON.stringify(body);
  const mod = url.protocol === 'https:' ? https : http;
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(raw))
      },
      timeout: 8000
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed: Record<string, unknown> = {};
        try { parsed = data ? JSON.parse(data) as Record<string, unknown> : {}; } catch {}
        if ((res.statusCode || 500) !== 200) {
          reject(new Error(String(parsed.error || `HTTP ${res.statusCode}`)));
          return;
        }
        resolve(parsed);
      });
    });
    req.on('error', err => reject(new Error(`cannot reach server: ${err.message}`)));
    req.on('timeout', () => req.destroy(new Error('cannot reach server: request timed out')));
    req.write(raw);
    req.end();
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
