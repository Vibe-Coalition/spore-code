import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import test from 'node:test';
import {WebSocketServer} from 'ws';
import {loadDeviceToken, parseToml} from '../src/config.js';
import {runDoctor} from '../src/doctor.js';
import type {SporeConfig} from '../src/protocol.js';

test('doctor persists password auth migration to device auth', async () => {
  const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-doctor-'));
  const lines: string[] = [];

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/spore-code/auth') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        assert.equal(parsed.username, 'tester');
        assert.equal(parsed.authMethod, 'password');
        assert.equal(parsed.password, 'secret');
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({
          ok: true,
          token: 'session-ticket',
          deviceToken: 'device-token',
          deviceId: 'device-id'
        }));
      });
      return;
    }
    res.writeHead(404, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({error: 'not found'}));
  });
  const wss = new WebSocketServer({server});
  wss.on('connection', (ws, req) => {
    assert.equal(req.url, '/ws?token=session-ticket');
    ws.send(JSON.stringify({type: 'capabilities', projectContext: true, sporeVersion: 'doctor-test'}));
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const cfg: SporeConfig = {
    connection: {
      host: '127.0.0.1',
      port,
      user: 'tester',
      auth_method: 'password',
      password: 'secret'
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
    localDir: path.join(globalDir, 'local')
  };

  const result = await runDoctor(cfg, {timeoutMs: 500, write: line => lines.push(line)});

  assert.equal(result.capabilities?.sporeVersion, 'doctor-test');
  assert.equal(cfg.connection.auth_method, 'device');
  assert.equal(cfg.connection.password, '');
  assert.equal(cfg.connection.device_id, 'device-id');
  assert.equal(loadDeviceToken(cfg), 'device-token');
  assert.match(lines.join('\n'), /Auth: ok/);
  const saved = parseToml(fs.readFileSync(path.join(globalDir, 'config.toml'), 'utf8'));
  assert.equal((saved.connection as any).auth_method, 'device');
  assert.equal((saved.connection as any).password, '');

  await new Promise<void>(resolve => wss.close(() => server.close(() => resolve())));
});
