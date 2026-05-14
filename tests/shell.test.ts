import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {BackgroundManager} from '../src/tools/background.js';
import {execTool} from '../src/tools/shell.js';

test('exec scope guard blocks obvious parent path access', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-exec-scope-'));
  const bg = new BackgroundManager(path.join(dir, '.spore-code', 'logs'));
  const result = await execTool({command: 'cat ../secret.txt'}, dir, path.join(dir, '.spore-code', 'logs'), bg, undefined, '');
  assert.equal(result.blocked, true);
  assert.match(String(result.error), /outside the working directory/);
});

test('foreground exec timeout adopts the running process instead of starting a duplicate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-exec-adopt-'));
  const logs = path.join(dir, '.spore-code', 'logs');
  const bg = new BackgroundManager(logs);
  const command = 'node -e "setTimeout(() => console.log(\'late-line\'), 500)"';

  const result = await execTool({command, timeout: 250}, dir, logs, bg, undefined, '');

  assert.equal(result.backgrounded, true);
  assert.equal(result.running, true);
  assert.equal(bg.list().length, 1);
  await new Promise(resolve => setTimeout(resolve, 850));
  const tail = bg.tail(Number(result.processId), 20);
  assert.match(String(tail.output), /late-line/);
});
