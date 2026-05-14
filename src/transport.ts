import {EventEmitter} from 'node:events';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {URL} from 'node:url';
import WebSocket from 'ws';
import type {InboundFrame, SporeConfig} from './protocol.js';
import {loadDeviceToken, saveDeviceToken} from './config.js';

interface AuthResponse {
  ok?: boolean;
  token?: string;
  user?: string;
  deviceToken?: string;
  deviceId?: string;
  error?: string;
}

export class SporeTransport extends EventEmitter {
  private ws: WebSocket | null = null;
  private token = '';
  private closed = false;
  private outbox: string[] = [];
  private reconnectAttempt = 0;
  private capabilitiesSeen = false;

  constructor(private readonly cfg: SporeConfig) {
    super();
  }

  get baseUrl(): string {
    const host = this.cfg.connection.host;
    if (host.includes('://')) return host.replace(/\/+$/, '');
    return `http://${host}:${this.cfg.connection.port}`;
  }

  async authenticate(): Promise<void> {
    const conn = this.cfg.connection;
    if (!authTransportAllowed(this.baseUrl)) {
      throw new Error(`refusing to send credentials over insecure HTTP to ${this.baseUrl}`);
    }
    if (conn.auth_method === 'device') {
      const deviceToken = loadDeviceToken(this.cfg);
      if (!deviceToken) throw new Error('missing device token; run setup again');
      const res = await this.post('/api/spore-code/session', undefined, {'Authorization': `Bearer ${deviceToken}`});
      this.applyAuth(res);
      return;
    }
    const body = conn.auth_method === 'password'
      ? {username: conn.user, authMethod: 'password', password: conn.password || '', issueDevice: true}
      : {username: conn.user, key: conn.key || '', issueDevice: true};
    const res = await this.post('/api/spore-code/auth', body);
    if (res.deviceToken) {
      conn.auth_method = 'device';
      conn.key = '';
      conn.password = '';
      conn.device_id = res.deviceId || conn.device_id || '';
      saveDeviceToken(this.cfg, res.deviceToken);
    }
    this.applyAuth(res);
  }

  async routingPresets(): Promise<Record<string, unknown>> {
    return await this.request('GET', '/api/spore-code/routing-presets', undefined, this.deviceHeaders());
  }

  async applyRoutingPreset(name: string): Promise<Record<string, unknown>> {
    return await this.request('POST', '/api/spore-code/routing-presets/apply', {name}, this.deviceHeaders());
  }

  async clearRoutingPreset(): Promise<Record<string, unknown>> {
    return await this.request('DELETE', '/api/spore-code/routing-presets/current', undefined, this.deviceHeaders());
  }

  async connect(): Promise<void> {
    if (!this.token) await this.authenticate();
    const u = new URL(this.baseUrl);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/ws';
    u.search = `?token=${encodeURIComponent(this.token)}`;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(u);
      this.ws = ws;
      const fail = (err: Error) => reject(err);
      ws.once('error', fail);
      ws.once('open', () => {
        ws.off('error', fail);
        this.reconnectAttempt = 0;
        this.emit('open');
        this.flushOutbox();
        resolve();
      });
      ws.on('message', data => this.handleMessage(String(data)));
      ws.on('close', () => {
        if (this.closed) return;
        this.emit('close');
        this.scheduleReconnect();
      });
      ws.on('error', err => this.emit('error', err));
    });
  }

  send(frame: Record<string, unknown>): void {
    const raw = JSON.stringify(frame);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(raw);
      return;
    }
    this.outbox.push(raw);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  hasProjectContextCapability(): boolean {
    return this.capabilitiesSeen;
  }

  private applyAuth(res: AuthResponse): void {
    if (!res.token) throw new Error(res.error || 'auth returned no token');
    this.token = res.token;
  }

  private async post(pathname: string, body?: unknown, headers: Record<string, string> = {}): Promise<AuthResponse> {
    return await this.request('POST', pathname, body, headers) as AuthResponse;
  }

  private async request(method: string, pathname: string, body?: unknown, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const u = new URL(pathname, this.baseUrl);
    const raw = body === undefined ? '' : JSON.stringify(body);
    const mod = u.protocol === 'https:' ? https : http;
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const req = mod.request(u, {
        method,
        headers: {
          ...(raw ? {'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(raw))} : {}),
          ...headers
        },
        timeout: 10_000
      }, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed: Record<string, unknown> = {};
          try { parsed = data ? JSON.parse(data) as Record<string, unknown> : {}; } catch {}
          if ((res.statusCode || 500) >= 300) {
            reject(new Error(String(parsed.error || `HTTP ${res.statusCode}: ${data.slice(0, 300)}`)));
            return;
          }
          resolve(parsed);
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('request timed out')));
      if (raw) req.write(raw);
      req.end();
    });
  }

  private deviceHeaders(): Record<string, string> {
    const token = loadDeviceToken(this.cfg);
    if (!token) throw new Error('missing device token');
    return {'Authorization': `Bearer ${token}`};
  }

  private handleMessage(raw: string): void {
    let frame: InboundFrame;
    try {
      frame = JSON.parse(raw) as InboundFrame;
    } catch {
      return;
    }
    if (frame.type === 'capabilities') {
      this.capabilitiesSeen = Boolean(frame.projectContext);
    }
    this.emit('frame', frame);
  }

  private flushOutbox(): void {
    const queued = this.outbox.splice(0);
    for (const raw of queued) this.ws?.send(raw);
  }

  private scheduleReconnect(): void {
    const wait = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt++);
    this.emit('reconnecting', this.reconnectAttempt);
    setTimeout(async () => {
      if (this.closed) return;
      try {
        await this.authenticate();
        await this.connect();
      } catch (err) {
        this.emit('error', err);
        this.scheduleReconnect();
      }
    }, wait);
  }
}

function authTransportAllowed(base: string): boolean {
  const u = new URL(base);
  if (u.protocol === 'https:') return true;
  const host = u.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (net.isIP(host)) {
    if (host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('169.254.')) return true;
    const parts = host.split('.').map(Number);
    if (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) return true;
  }
  return /^(1|true|yes)$/i.test(process.env.SPORE_CODE_ALLOW_INSECURE_AUTH || '');
}
