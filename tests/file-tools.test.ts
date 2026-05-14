import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {editFileTool, globTool, grepTool, patchFileTool, readFileTool, writeFileTool} from '../src/tools/file-tools.js';

test('file tools write, read ranges, and edit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-code-'));
  const write = writeFileTool({path: 'a.txt', content: 'one\ntwo\nthree'}, dir, '');
  assert.equal(write.ok, true);
  const read = readFileTool({path: 'a.txt', start_line: 2, end_line: 3}, dir, '');
  assert.equal(read.content, '2\ttwo\n3\tthree');
  const edit = editFileTool({path: 'a.txt', old_string: 'two', new_string: 'TWO'}, dir, '');
  assert.equal(edit.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one\nTWO\nthree');
});

test('file tools block paths outside cwd in strict scope', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-code-'));
  const res = readFileTool({path: '../nope'}, dir, '');
  assert.match(String(res.error), /outside the working directory/);
});

test('editFileTool tolerates CRLF mismatch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-code-'));
  fs.writeFileSync(path.join(dir, 'crlf.txt'), 'one\r\ntwo\r\nthree\r\n');
  const edit = editFileTool({path: 'crlf.txt', old_string: 'one\ntwo', new_string: 'ONE\nTWO'}, dir, '');
  assert.equal(edit.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'crlf.txt'), 'utf8'), 'ONE\r\nTWO\r\nthree\r\n');
});

test('patchFileTool applies safe git-style patches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-code-'));
  fs.writeFileSync(path.join(dir, 'p.txt'), 'one\n');
  const patch = `--- a/p.txt
+++ b/p.txt
@@ -1 +1 @@
-one
+two
`;
  const res = patchFileTool({patch}, dir, '');
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'p.txt'), 'utf8'), 'two\n');
});

test('glob and grep stay inside strict scope', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spore-code-scope-'));
  fs.writeFileSync(path.join(dir, 'inside.txt'), 'needle\n');
  const outside = path.join(path.dirname(dir), 'outside.txt');
  fs.writeFileSync(outside, 'needle\n');

  const globOutside = await globTool({pattern: '../*.txt'}, dir, '');
  assert.match(String(globOutside.error), /outside the working directory/);

  const grepOutside = await grepTool({query: 'needle', path: '..'}, dir, '');
  assert.match(String(grepOutside.error), /outside the working directory/);

  const grepInside = await grepTool({query: 'needle', glob: '*.txt'}, dir, '');
  assert.equal(grepInside.ok, true);
  assert.equal((grepInside.matches as unknown[]).length, 1);
});
