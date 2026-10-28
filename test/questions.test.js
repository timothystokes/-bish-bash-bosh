import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseQuestions, formatQuestions, nextBatch, renderBatch, resolveAnswer, recordAnswers,
  parseResponse, applyResponse, pendingAnswers, unanswered, STORE_HEADER,
} from '../src/hodge-questions.js';
import { runObjective } from '../src/hodge-objective.js';
import { freshDir, seedObjectiveProject, writeProjectConfig } from './support/project.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

/** @param {number} id @param {string} topic @param {object} [more] */
const q = (id, topic, more = {}) => ({ id, topic, text: `Question ${id}?`, default: `d${id}`, specified: false, ...more });

test('Q-1: the store round-trips through code-owned lines with ids, defaults, answers and specs', () => {
  const qs = [q(1, 'Greeting'), q(2, 'Greeting', { answer: 'yes; no\nmaybe' }), q(3, 'Errors', { specified: true, answer: '64', spec: 'specs/e.md' })];
  const text = formatQuestions(qs);
  assert.ok(text.startsWith(STORE_HEADER));
  assert.match(text, /^1 - Answered: \[ \]; Specified: \[ \]; Topic: Greeting; Q: Question 1\?; Default: d1$/m);
  assert.match(text, /^3 - Answered: \[x\]; Specified: \[x\]; Topic: Errors; Q: Question 3\?; A: 64; Spec: specs\/e\.md$/m);
  assert.deepEqual(parseQuestions(text), parseQuestions(formatQuestions(parseQuestions(text))));
  assert.equal(parseQuestions(text)[1].answer, 'yes, no maybe', 'separators and newlines in an answer are flattened');
  assert.deepEqual(parseQuestions(STORE_HEADER), []);
});

test('Q-2: code picks the batch: unanswered open questions in order, at most 3 topics and 8 questions', () => {
  const qs = [
    q(1, 'A', { specified: true }), q(2, 'A', { answer: 'x' }), q(3, 'A'),
    ...[4, 5, 6, 7, 8, 9, 10, 11].map((i) => q(i, 'B')),
    q(12, 'C'), q(13, 'D'),
  ];
  assert.deepEqual(nextBatch(qs).map((b) => b.n), [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(unanswered(qs).map((x) => x.id).slice(0, 2), [3, 4]);
  assert.deepEqual(pendingAnswers(qs).map((x) => x.id), [2]);
  assert.deepEqual(nextBatch([q(1, 'A'), q(2, 'B'), q(3, 'C'), q(4, 'D')]).map((b) => b.n), [1, 2, 3]);
  assert.deepEqual(nextBatch([q(1, 'A', { specified: true })]), []);
});

test('Q-3: the batch renders as topics over numbered questions with defaults', () => {
  assert.equal(renderBatch(nextBatch([q(1, 'A'), q(2, 'B'), q(3, 'A')])), '## A\n1. Question 1? Default: d1\n3. Question 3? Default: d3\n\n## B\n2. Question 2? Default: d2');
});

test('Q-4: "y" accepts every default; index answers override only the named questions; bad replies are rejected with a hint', () => {
  const b = nextBatch([q(1, 'A'), q(2, 'A'), q(3, 'B')]);
  const all = resolveAnswer(b, 'y');
  assert.ok(all.ok && all.answers.every((a) => a.source === 'default'));
  const some = resolveAnswer(b, '2: yes, with a default; 3: 64');
  assert.ok(some.ok);
  assert.deepEqual(some.answers.map((a) => [a.n, a.answer, a.source]), [[1, 'd1', 'default'], [2, 'yes, with a default', 'owner'], [3, '64', 'owner']]);
  for (const bad of ['9: x', 'maybe', '', '2:']) {
    const r = resolveAnswer(b, bad);
    assert.equal(r.ok, false, bad);
    assert.match(/** @type {{reason: string}} */ (r).reason, /N: answer|index/i);
  }
  assert.deepEqual(recordAnswers([q(1, 'A'), q(3, 'B')], some.answers).map((x) => x.answer), ['d1', '64']);
});

test('Q-5: the agent response is validated against the answers it was given', () => {
  const ok = parseResponse('{"resolved":[{"id":2,"spec":"specs/a.md"}],"gaps":[{"topic":"T","question":"Q?","default":"d"}]}', [2]);
  assert.ok(ok.ok);
  for (const [text, why] of [
    ['nope', /JSON/],
    ['{"resolved":[]}', /resolved.*gaps/],
    ['{"resolved":[{"id":9,"spec":"s"}],"gaps":[]}', /id 9.*not answered/],
    ['{"resolved":[{"id":2}],"gaps":[]}', /spec/],
    ['{"resolved":[],"gaps":[{"topic":"T","question":"Q?"}]}', /topic.*question.*default/],
  ]) {
    const r = parseResponse(/** @type {string} */ (text), [2]);
    assert.equal(r.ok, false, String(text));
    assert.match(/** @type {{reason: string}} */ (r).reason, /** @type {RegExp} */ (why));
  }
});

test('Q-6: code updates status from the response: resolved are specified with their spec, unresolved are re-asked, gaps are new', () => {
  const qs = [q(1, 'A', { answer: 'one' }), q(2, 'A', { answer: 'two' }), q(3, 'B')];
  const out = applyResponse(qs, {
    resolved: [{ id: 1, spec: 'specs/a.md' }],
    gaps: [{ topic: 'C', question: 'New gap?', default: 'dn' }, { topic: 'B', question: 'question 3?', default: 'dup' }],
  });
  assert.deepEqual(out[0], { ...qs[0], specified: true, spec: 'specs/a.md' });
  assert.deepEqual(out[1], { id: 2, topic: 'A', text: 'Question 2?', default: 'two', specified: false });
  assert.deepEqual(out[2], qs[2]);
  assert.deepEqual(out.slice(3), [{ id: 4, topic: 'C', text: 'New gap?', default: 'dn', specified: false }], 'a repeated question is dropped, new ids continue');
});

test('Q-7: a round is driven by code: the agent gets only the answers by id, never the conversation or the store', async () => {
  const repo = freshDir('q-');
  seedObjectiveProject(repo);
  const config = { roles: { build: { adapter: 'a', model: 'm' } }, budgets: { maxWallClockSeconds: 60, maxIterations: 5 }, allowedPaths: ['src/'] };
  writeProjectConfig(repo, config);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'seed');
  const batch = { resolved: [], gaps: [{ topic: 'Greeting', question: 'Print to stdout?', default: 'yes' }, { topic: 'Errors', question: 'Exit code on bad input?', default: '2' }] };
  /** @type {string[]} */
  const prompts = [];
  const adapter = {
    async run(req) {
      prompts.push(req.prompt);
      if (prompts.length === 1) writeFileSync(join(req.cwd, 'objective', 'RESPONSE.json'), JSON.stringify(batch));
      return { transcript: 't', exitStatus: 0, changedFiles: [] };
    },
  };
  const replies = ['desc', '3: 64'];
  /** @type {string[]} */
  const said = [];
  await runObjective({
    config, repoDir: repo, runId: 'r', adapter, maxRounds: 2,
    ask: async () => replies.shift() ?? null, say: (t) => said.push(t),
    identity: { root: '/nonexistent/hodgepodge', remotes: [] },
  });
  assert.match(said[0], /## Greeting\n2\. Print to stdout\? Default: yes[\s\S]*## Errors\n3\. Exit code on bad input\? Default: 2/);
  assert.match(said[0], /y to accept all defaults/i);
  assert.match(readFileSync(join(repo, 'objective', 'QUESTIONS.md'), 'utf8'), /Default: yes[\s\S]*Default: 64|Default: 64[\s\S]*Default: yes/, 'answered-but-unresolved questions keep the owner\'s answer as their new default');
  assert.match(prompts[1], /Q2 \[Greeting\] Print to stdout\?: yes/);
  assert.match(prompts[1], /Q3 \[Errors\] Exit code on bad input\?: 64/);
  for (const p of prompts) assert.doesNotMatch(p, /## objective\/QUESTIONS/, 'the question store is never shown');
  assert.match(prompts[1], /never open objective\/QUESTIONS\.md/i);
});
