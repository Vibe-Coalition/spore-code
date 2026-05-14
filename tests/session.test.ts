import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {computeSessionId, listProjectSessions, loadProjectLastSession, resolveSessionId, saveApprovedPlan, saveProjectLastSession, SessionLog} from '../src/session.js';
import type {SporeConfig} from '../src/protocol.js';

test('computeSessionId uses cli user project shape', () => {
  const id = computeSessionId('yam', process.cwd(), false);
  assert.match(id, /^cli:yam@/);
});

test('saveApprovedPlan writes a timestamped plan artifact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-plan-'));
  const file = saveApprovedPlan(dir, 'PLAN_READY\n\n1. Do the thing', new Date('2026-05-14T00:00:00Z'));
  assert.equal(path.basename(file), 'plan-20260514T000000Z.md');
  assert.match(fs.readFileSync(file, 'utf8'), /Approved Plan/);
  assert.match(fs.readFileSync(file, 'utf8'), /Do the thing/);
});

test('project last session pointer round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-session-pointer-'));
  assert.equal(loadProjectLastSession(dir), '');
  saveProjectLastSession(dir, 'cli:yam@test-abc-20260514T000000Z');
  assert.equal(loadProjectLastSession(dir), 'cli:yam@test-abc-20260514T000000Z');
});

test('resolveSessionId prefers explicit and saved project sessions for continue', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-session-resolve-'));
  saveProjectLastSession(dir, 'cli:project-last');

  assert.deepEqual(resolveSessionId('yam', dir, {explicitSessionId: 'cli:explicit'}), {
    sessionId: 'cli:explicit',
    isContinue: true,
    source: 'explicit'
  });
  assert.deepEqual(resolveSessionId('yam', dir, {continueRequested: true}), {
    sessionId: 'cli:project-last',
    isContinue: true,
    source: 'project-last'
  });
});

test('resolveSessionId falls back to global last for same cwd then deterministic resume', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-session-global-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-session-other-'));

  assert.deepEqual(resolveSessionId('yam', dir, {
    continueRequested: true,
    globalLast: {sessionId: 'cli:global-last', cwd: dir}
  }), {
    sessionId: 'cli:global-last',
    isContinue: true,
    source: 'global-last'
  });

  const fallback = resolveSessionId('yam', dir, {
    continueRequested: true,
    globalLast: {sessionId: 'cli:other-last', cwd: other}
  });
  assert.equal(fallback.isContinue, true);
  assert.equal(fallback.source, 'deterministic');
  assert.match(fallback.sessionId, /^cli:yam@/);
});

test('resolveSessionId creates a fresh timestamped session by default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-session-fresh-'));
  const fresh = resolveSessionId('yam', dir);
  assert.equal(fresh.isContinue, false);
  assert.equal(fresh.source, 'fresh');
  assert.match(fresh.sessionId, /^cli:yam@.*-\d{8}T\d{6}Z$/);
});

test('listProjectSessions reads local JSONL session logs for current project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-session-list-'));
  const cfg: SporeConfig = {
    connection: {
      host: 'localhost',
      port: 18810,
      user: 'yam',
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
  const sessionId = computeSessionId('yam', dir, true);
  const log = new SessionLog(cfg, sessionId);
  log.writeMessage({role: 'user', text: 'hello there', timestamp: Date.now()});
  log.writeAssistant('general kenobi');

  const rows = listProjectSessions(cfg, dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sessionId, sessionId);
  assert.equal(rows[0]?.messageCount, 2);
  assert.equal(rows[0]?.preview, 'general kenobi');
});
