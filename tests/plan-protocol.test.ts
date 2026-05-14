import assert from 'node:assert/strict';
import test from 'node:test';
import {isPlanReady, normalizeQuestionAnswer, parsePlanQuestions} from '../src/controller.js';

test('parsePlanQuestions extracts options from QUESTIONS block', () => {
  const q = parsePlanQuestions(`QUESTIONS:
1. What matters most? [Speed / Quality / Both]
2. Any constraints?
`);
  assert.ok(q);
  assert.equal(q.source, 'plan');
  assert.equal(q.options.length, 3);
  assert.equal(q.options[0]?.label, 'Speed');
  assert.match(q.question, /What matters most/);
});

test('isPlanReady detects standalone marker', () => {
  assert.equal(isPlanReady('do this\nPLAN_READY\n'), true);
  assert.equal(isPlanReady('PLAN_READY-ish'), false);
});

test('normalizeQuestionAnswer maps numeric multi-select answers', () => {
  const options = [{label: 'Speed'}, {label: 'Quality'}, {label: 'Both'}];
  const out = normalizeQuestionAnswer('1, 3', options, true);
  assert.equal(out.answer, 'Speed, Both');
  assert.deepEqual(out.answers, ['Speed', 'Both']);
});

test('parsePlanQuestions handles fenced JSON question blocks', () => {
  const q = parsePlanQuestions(`QUESTIONS:
\`\`\`json
[
  {"text":"Pick targets","type":"multi","options":[{"label":"UI"},{"label":"Tools"}]}
]
\`\`\`
`);
  assert.ok(q);
  assert.equal(q.multi, true);
  assert.equal(q.options[1]?.label, 'Tools');
});
