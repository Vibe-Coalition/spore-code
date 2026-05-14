import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {ToolExecutor} from '../src/tools/executor.js';

test('approval can allow a matching tool rule for the session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-approval-'));
  let approvals = 0;
  const executor = new ToolExecutor(dir, path.join(dir, '.spore-code', 'logs'), '', {
    approve: async req => {
      approvals++;
      assert.equal(req.rule, 'write_file:*');
      return {allowed: true, addRule: true};
    }
  });

  const first = await executor.execute('write_file', {path: 'a.txt', content: 'one'});
  const second = await executor.execute('write_file', {path: 'b.txt', content: 'two'});

  assert.equal(first.result && (first.result as any).ok, true);
  assert.equal(second.result && (second.result as any).ok, true);
  assert.equal(approvals, 1);
  assert.deepEqual(executor.approvalRuleList(), ['write_file:*']);
});
