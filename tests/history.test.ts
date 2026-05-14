import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {CommandHistory} from '../src/history.js';

test('command history persists entries and restores current draft', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-history-'));
  const file = path.join(dir, 'history.jsonl');

  const history = new CommandHistory(file);
  history.add('first command');
  history.add('second\ncommand');

  assert.equal(history.previous('draft'), 'second\ncommand');
  assert.equal(history.previous('draft'), 'first command');
  assert.equal(history.next(), 'second\ncommand');
  assert.equal(history.next(), 'draft');

  const reloaded = new CommandHistory(file);
  assert.equal(reloaded.previous(''), 'second\ncommand');
});
