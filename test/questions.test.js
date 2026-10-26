import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBatch, resolveAnswer, formatBatchLog } from '../src/questions.js';
import { initSandbox } from '../src/init-sandbox.js';
import { runObjective } from '../src/objective.js';

const batchText = `## Greeting
1. Print to stdout? Default: yes
2. Require a name argument? Default: no

## Errors
3. Exit code on bad input? Default: 2
`;

test('Q-1: parseBatch groups numbered questions under their topic with defaults', () => {
  const b = parseBatch(batchText);
  assert.deepEqual(b?.map((q) => [q.n, q.topic, q.text, q.default]), [
    [1, 'Greeting', 'Print to stdout?', 'yes'],
    [2, 'Greeting', 'Require a name argument?', 'no'],
    [3, 'Errors', 'Exit code on bad input?', '2'],
  ]);
});

test('Q-1: text without numbered questions is not a batch; a numbered question without a Default is rejected', () => {
  assert.equal(parseBatch('Who uses it?\nDefault: devs\n'), null);
  assert.throws(() => parseBatch('## T\n1. No default here\n'), /question 1.*Default/i);
  assert.throws(() => parseBatch('## T\n1. A? Default: x\n1. B? Default: y\n'), /duplicate/i);
});

test('Q-2: "y" accepts every default; index answers override only the named questions', () => {
  const b = /** @type {NonNullable<ReturnType<typeof parseBatch>>} */ (parseBatch(batchText));
  const all = resolveAnswer(b, 'y');
  assert.ok(all.ok && all.answers.every((a) => a.source === 'default'));
  const some = resolveAnswer(b, '2: yes, with a default; 3: 64');
  assert.ok(some.ok);
  assert.deepEqual(some.answers.map((a) => [a.n, a.answer, a.source]), [[1, 'yes', 'default'], [2, 'yes, with a default', 'owner'], [3, '64', 'owner']]);
});

test('Q-2: unknown index, unparsable text or an empty answer is rejected with a hint; done is not an answer', () => {
  const b = /** @type {NonNullable<ReturnType<typeof parseBatch>>} */ (parseBatch(batchText));
  for (const bad of ['9: x', 'maybe', '', '2:']) {
    const r = resolveAnswer(b, bad);
    assert.equal(r.ok, false, bad);
    assert.match(/** @type {{reason: string}} */ (r).reason, /N: answer|index/i);
  }
});

test('Q-3: the log lists every question with its topic, answer and whether it was a default', () => {
  const b = /** @type {NonNullable<ReturnType<typeof parseBatch>>} */ (parseBatch(batchText));
  const r = resolveAnswer(b, '3: 64');
  assert.ok(r.ok);
  const log = formatBatchLog(b, r.answers);
  assert.match(log, /Q1 \[Greeting\] Print to stdout\?\n {2}A1 \(default\): yes/);
  assert.match(log, /Q3 \[Errors\] Exit code on bad input\?\n {2}A3 \(owner\): 64/);
});

test('Q-4: a batched round is shown once and one reply answers all of it; the next round sees the log', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'q-')), 'sb');
  initSandbox({ dir, adapter: 'a', model: 'm', seed: 'objective' });
  const repo = join(dir, 'target');
  const config = JSON.parse(readFileSync(join(dir, 'hodge.json'), 'utf8'));
  config.targetRepo = repo;
  /** @type {string[]} */
  const prompts = [];
  let call = 0;
  const adapter = {
    /** @param {import('../src/adapter.js').AdapterRequest} req */
    async run(req) {
      prompts.push(req.prompt);
      call++;
      if (call === 1) writeFileSync(join(req.cwd, 'objective', 'QUESTION.md'), batchText);
      return { transcript: 't', usage: { tokens: 1, cost: 0.01 }, exitStatus: 0, changedFiles: [] };
    },
  };
  const replies = ['desc', '3: 64'];
  /** @type {string[]} */
  const said = [];
  const res = await runObjective({
    config, repoDir: repo, runId: 'r', adapter,
    ask: async () => replies.shift() ?? null, say: (t) => said.push(t),
    identity: { root: '/nonexistent/hodgepodge', remotes: [] },
  });
  assert.notEqual(res.status, 'paused');
  assert.equal(prompts.length >= 2, true);
  assert.match(said[0], /## Greeting[\s\S]*## Errors/);
  assert.match(said[0], /y to accept all defaults/i);
  const convo = readFileSync(join(repo, 'objective', 'CONVERSATION.md'), 'utf8');
  assert.match(convo, /A3 \(owner\): 64/);
  assert.match(convo, /A1 \(default\): yes/);
  assert.match(prompts[1], /A3 \(owner\): 64/);
});
