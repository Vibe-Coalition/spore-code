import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {authMissingReason, authReady, deleteDeviceToken, loadDeviceToken, parseToml, resetAuth, saveDeviceToken} from '../src/config.js';
import type {SporeConfig} from '../src/protocol.js';

test('parseToml reads sections and primitive values', () => {
  const parsed = parseToml(`
[connection]
host = "localhost"
port = 18810
auth_method = "device"

[display]
show_tools = true
`);
  assert.equal((parsed.connection as any).host, 'localhost');
  assert.equal((parsed.connection as any).port, 18810);
  assert.equal((parsed.display as any).show_tools, true);
});

test('device tokens are scoped by host, port, and user', () => {
  const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-token-'));
  const cfg = testConfig(globalDir, 'alice');
  const otherUser = testConfig(globalDir, 'bob');

  saveDeviceToken(cfg, 'alice-token');
  saveDeviceToken(otherUser, 'bob-token');

  assert.equal(loadDeviceToken(cfg), 'alice-token');
  assert.equal(loadDeviceToken(otherUser), 'bob-token');

  deleteDeviceToken(cfg);
  assert.equal(loadDeviceToken(cfg), '');
  assert.equal(loadDeviceToken(otherUser), 'bob-token');
});

test('authReady reports missing and present credentials by method', () => {
  const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-auth-ready-'));
  const cfg = testConfig(globalDir, 'alice');

  assert.equal(authReady(cfg), false);
  assert.equal(authMissingReason(cfg), 'missing device token');
  saveDeviceToken(cfg, 'device-token');
  assert.equal(authReady(cfg), true);

  cfg.connection.auth_method = 'password';
  cfg.connection.password = '';
  assert.equal(authReady(cfg), false);
  cfg.connection.password = 'secret';
  assert.equal(authReady(cfg), true);

  cfg.connection.auth_method = 'invite';
  cfg.connection.key = '';
  assert.equal(authReady(cfg), false);
  cfg.connection.key = 'invite-key';
  assert.equal(authReady(cfg), true);
});

test('resetAuth clears credentials and returns config to missing-device-token setup state', () => {
  const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-reset-auth-'));
  const cfg = testConfig(globalDir, 'alice');
  cfg.connection.auth_method = 'password';
  cfg.connection.password = 'secret';
  cfg.connection.key = 'invite-key';
  cfg.connection.device_id = 'device-id';
  saveDeviceToken(cfg, 'device-token');

  resetAuth(cfg);

  assert.equal(cfg.connection.auth_method, 'device');
  assert.equal(cfg.connection.password, '');
  assert.equal(cfg.connection.key, '');
  assert.equal(cfg.connection.device_id, '');
  assert.equal(loadDeviceToken(cfg), '');
  assert.equal(authReady(cfg), false);
  assert.equal(authMissingReason(cfg), 'missing device token');
});

function testConfig(globalDir: string, user: string): SporeConfig {
  return {
    connection: {
      host: 'localhost',
      port: 18810,
      user,
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
