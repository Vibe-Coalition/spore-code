import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {SporeController} from '../src/controller.js';
import type {SporeConfig} from '../src/protocol.js';

test('controller replies null for server-side tool fallback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-controller-'));
  const cfg: SporeConfig = {
    connection: {
      host: '127.0.0.1',
      port: 18810,
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
    globalDir: path.join(dir, 'global'),
    localDir: path.join(dir, '.spore-code')
  };
  const sent: Record<string, unknown>[] = [];
  const controller = new SporeController(cfg, dir, 'cli:test', false, false);
  (controller as any).transport = {send: (frame: Record<string, unknown>) => sent.push(frame)};

  await (controller as any).handleTool({type: 'tool:request', id: 'tool-1', name: 'web_search', input: {q: 'spore'}});

  assert.deepEqual(sent[0], {type: 'tool:ack', id: 'tool-1'});
  assert.deepEqual(sent[1], {type: 'tool:result', id: 'tool-1', result: null});
});

test('controller sends Core-compatible chat frame type', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-controller-chat-'));
  const cfg = testConfig(dir);
  const sent: Record<string, unknown>[] = [];
  const controller = new SporeController(cfg, dir, 'cli:tester@test', false, false);
  (controller as any).transport = {send: (frame: Record<string, unknown>) => sent.push(frame)};

  controller.sendUser('hello');

  const frame = sent.find(item => item.type === 'chat');
  assert.ok(frame);
  assert.equal(frame.content, 'hello');
  assert.equal(frame.sessionId, 'cli:tester@test');
});

function testConfig(dir: string): SporeConfig {
  return {
    connection: {
      host: '127.0.0.1',
      port: 18810,
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
    globalDir: path.join(dir, 'global'),
    localDir: path.join(dir, '.spore-code')
  };
}
