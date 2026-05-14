import assert from 'node:assert/strict';
import test from 'node:test';
import {helpText, parseArgs} from '../src/cli-args.js';

test('parseArgs accepts commands before or after options', () => {
  assert.deepEqual(parseArgs(['--user', 'yam', 'logout']), {
    user: 'yam',
    command: 'logout'
  });
  assert.deepEqual(parseArgs(['doctor', '--host=spore.local', '--port', '18803']), {
    command: 'doctor',
    host: 'spore.local',
    port: 18803
  });
});

test('parseArgs normalizes command aliases', () => {
  assert.deepEqual(parseArgs(['config']), {command: 'setup'});
  assert.deepEqual(parseArgs(['configure']), {command: 'setup'});
  assert.deepEqual(parseArgs(['login']), {command: 'setup'});
  assert.deepEqual(parseArgs(['check']), {command: 'doctor'});
  assert.deepEqual(parseArgs(['smoke']), {command: 'smoke'});
});

test('parseArgs handles session, continuation, plan, version, and help flags', () => {
  assert.deepEqual(parseArgs(['-c', '--plan', '--session', 'cli:test', '-v', '-h']), {
    continue: true,
    plan: true,
    session: 'cli:test',
    version: true,
    help: true
  });
});

test('parseArgs rejects missing option values and unknown flags', () => {
  assert.throws(() => parseArgs(['--host']), /--host requires a value/);
  assert.throws(() => parseArgs(['--host=']), /--host requires a value/);
  assert.throws(() => parseArgs(['--port', 'wat']), /--port must be a number/);
  assert.throws(() => parseArgs(['--port=70000']), /--port must be between/);
  assert.throws(() => parseArgs(['setup', 'doctor']), /multiple commands supplied/);
  assert.throws(() => parseArgs(['--wat']), /unknown argument/);
});

test('helpText includes commands and key flags', () => {
  const text = helpText('test-version');
  assert.match(text, /spore test-version/);
  assert.match(text, /doctor/);
  assert.match(text, /smoke/);
  assert.match(text, /Aliases:/);
  assert.match(text, /--session <id>/);
});
