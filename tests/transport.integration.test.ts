import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import test from 'node:test';
import {WebSocketServer} from 'ws';
import {saveDeviceToken} from '../src/config.js';
import type {SporeConfig} from '../src/protocol.js';
import {runSmoke} from '../src/smoke.js';
import {SporeTransport} from '../src/transport.js';

test('transport authenticates with device token and exchanges websocket frames', async () => {
  const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-transport-'));
  const received: Record<string, unknown>[] = [];

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/spore-code/session') {
      assert.equal(req.headers.authorization, 'Bearer device-token');
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ok: true, token: 'session-ticket'}));
      return;
    }
    res.writeHead(404, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({error: 'not found'}));
  });
  const wss = new WebSocketServer({server});
  wss.on('connection', (ws, req) => {
    assert.equal(req.url, '/ws?token=session-ticket');
    ws.send(JSON.stringify({type: 'capabilities', projectContext: true, sporeVersion: 'test'}));
    ws.on('message', raw => received.push(JSON.parse(String(raw)) as Record<string, unknown>));
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const cfg: SporeConfig = {
    connection: {
      host: '127.0.0.1',
      port,
      user: 'tester',
      auth_method: 'device'
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
  saveDeviceToken(cfg, 'device-token');

  const transport = new SporeTransport(cfg);
  const framePromise = once(transport, 'frame');
  await transport.authenticate();
  await transport.connect();
  const [frame] = await framePromise as [{type: string; projectContext?: boolean}];
  assert.equal(frame.type, 'capabilities');
  assert.equal(transport.hasProjectContextCapability(), true);

  transport.send({type: 'chat:history-request', sessionId: 'cli:test'});
  await waitFor(() => received.some(frame => frame.type === 'chat:history-request'));

  transport.close();
  await new Promise<void>(resolve => wss.close(() => server.close(() => resolve())));
});

test('smoke command authenticates and exercises session start/history frames', async () => {
  const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-smoke-'));
  const received: Record<string, unknown>[] = [];

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/spore-code/session') {
      assert.equal(req.headers.authorization, 'Bearer device-token');
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ok: true, token: 'session-ticket'}));
      return;
    }
    res.writeHead(404, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({error: 'not found'}));
  });
  const wss = new WebSocketServer({server});
  wss.on('connection', (ws, req) => {
    assert.equal(req.url, '/ws?token=session-ticket');
    ws.send(JSON.stringify({type: 'capabilities', projectContext: true, sporeVersion: 'smoke-test'}));
    ws.on('message', raw => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>;
      received.push(frame);
      if (frame.type === 'chat:history-request') {
        ws.send(JSON.stringify({type: 'chat:history', messages: []}));
      }
    });
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const cfg = testConfig(globalDir, port);
  saveDeviceToken(cfg, 'device-token');
  const lines: string[] = [];

  const result = await runSmoke(cfg, globalDir, {timeoutMs: 1000, write: line => lines.push(line)});

  assert.equal(result.capabilities?.sporeVersion, 'smoke-test');
  assert.equal(result.historySeen, true);
  assert.ok(received.some(frame => frame.type === 'session:start'));
  assert.ok(received.some(frame => frame.type === 'chat:history-request'));
  assert.match(lines.join('\n'), /Manual beta checklist/);

  await new Promise<void>(resolve => wss.close(() => server.close(() => resolve())));
});

async function waitFor(fn: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('condition was not met before timeout');
}

function testConfig(globalDir: string, port: number): SporeConfig {
  return {
    connection: {
      host: '127.0.0.1',
      port,
      user: 'tester',
      auth_method: 'device'
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
}
