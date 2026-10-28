import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { initSandbox } from '../src/init-sandbox.js';
import { runObjective } from '../src/objective.js';
import { sumRunUsage } from '../src/budget-gate.js';
import { main } from '../src/cli.js';

const identity = { root: '/nonexistent/hodgepodge', remotes: [] };
const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

const goodSpec = `# Spec: Greeter
Implementation: none

## Requirements
- R-greet-1: \`greet(name)\` must return "Hello, name!".
- R-greet-2: \`greet\` must throw a TypeError when name is not a string.
- R-greet-3: \`greet\` must trim surrounding whitespace from name.

## Examples
- \`greet('Ann')\` -> \`Hello, Ann!\`
- \`greet(1)\` -> throws TypeError

## Dimensions
- Actors and goals: covered
- Behaviour: covered
- Inputs and outputs: covered
- Failure paths: covered
- Edge cases: n/a: single-purpose pure function
- Interfaces and data: n/a: one in-process function
- Non-functional: n/a: no runtime limits for a pure function
- Constraints: n/a: no platform constraints
- Acceptance: covered
- Out of scope: covered

## Out of scope
- Localisation.
`;
const coarse = goodSpec.replace(/- R-greet-3: .*\n/, '');

/** @param {string} cwd @param {Record<string, string | null>} writes null deletes */
function write(cwd, writes) {
  for (const [f, text] of Object.entries(writes)) {
    if (text === null) rmSync(join(cwd, f), { force: true });
    else {
      mkdirSync(dirname(join(cwd, f)), { recursive: true });
      writeFileSync(join(cwd, f), text);
    }
  }
}

/** Scripted interviewer: one entry of writes per round. */
function scripted(/** @type {Record<string, string | null>[]} */ rounds) {
  /** @type {string[]} */
  const prompts = [];
  return {
    prompts,
    adapter: {
      /** @param {import('../src/adapter.js').AdapterRequest} req */
      async run(req) {
        prompts.push(req.prompt);
        const writes = rounds[prompts.length - 1] ?? {};
        write(req.cwd, writes);
        return { transcript: 't', exitStatus: 0, changedFiles: Object.keys(writes) };
      },
    },
  };
}

const sandbox = () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'obj-')), 'sb');
  assert.equal(initSandbox({ dir, adapter: 'a', model: 'm', seed: 'objective' }).ok, true);
  return { dir, repo: join(dir, 'target'), config: JSON.parse(readFileSync(join(dir, 'hodge.json'), 'utf8')) };
};

/** @param {(string | null)[]} answers */
function owner(answers) {
  /** @type {string[]} */
  const asked = [];
  /** @type {string[]} */
  const said = [];
  const queue = [...answers];
  return { asked, said, ask: async (/** @type {string} */ p) => (asked.push(p), queue.length ? queue.shift() ?? null : null), say: (/** @type {string} */ t) => said.push(t) };
}

/** The agent's RESPONSE.json: ids it resolved (with a spec) and the gaps it found. */
const resp = (/** @type {number[]} */ resolved, /** @type {string[]} */ gaps = []) =>
  JSON.stringify({
    resolved: resolved.map((id) => ({ id, spec: 'specs/greet.md' })),
    gaps: gaps.map((g) => ({ topic: 'Greeter', question: g, default: 'Yes' })),
  });

/** @type {Record<string, string | null>[]} */
const fullRounds = [
  { 'objective/RESPONSE.json': resp([], ['Who uses the greeter?']), 'objective/notes.md': 'n\n' },
  { 'specs/greet.md': coarse, 'objective/RESPONSE.json': resp([1], ['Should names be trimmed?']) },
  { 'specs/greet.md': goodSpec, 'objective/RESPONSE.json': resp([2]) },
];

test('asks for the description first, then alternates rounds and answers broad to fine until ready', async () => {
  const { repo, config } = sandbox();
  const a = scripted(fullRounds);
  const o = owner(['A greeter library for Ann', '1: Developers', '2: Yes, trim']);
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ask: o.ask, say: o.say, identity });
  assert.deepEqual(res, { status: 'ok', rounds: 3 });
  assert.match(o.asked[0], /Describe the objective/);
  assert.match(o.said[0], /1\. Who uses the greeter\?/);
  assert.match(o.said[1], /2\. Should names be trimmed\?/);
  assert.match(readFileSync(join(repo, 'objective', 'BRIEF.md'), 'utf8'), /A greeter library for Ann/);
  const convo = readFileSync(join(repo, 'objective', 'CONVERSATION.md'), 'utf8');
  assert.match(convo, /Who uses the greeter\?[\s\S]*Developers/);
  assert.match(convo, /Should names be trimmed\?[\s\S]*Yes, trim/);
  const store = readFileSync(join(repo, 'objective', 'OPEN-QUESTIONS.md'), 'utf8');
  assert.match(store, /- \[x\] Q1 \[Greeter\] Who uses the greeter\? \| answer: Developers \| spec: specs\/greet\.md/);
  assert.match(store, /- \[x\] Q2 .*answer: Yes, trim/, 'statuses are updated by code from the response');
  assert.equal(git(repo, 'status', '--porcelain'), '');
  // stage and context progress across rounds
  assert.match(a.prompts[0], /## Stage: broad/);
  assert.match(a.prompts[0], /A greeter library for Ann/);
  assert.match(a.prompts[1], /## Stage: broad/);
  assert.match(a.prompts[1], /Q1 \[Greeter\] Who uses the greeter\?: Developers/);
  assert.match(a.prompts[2], /## Stage: fine/);
  assert.match(a.prompts[2], /Q2 \[Greeter\] Should names be trimmed\?: Yes, trim/);
  assert.doesNotMatch(a.prompts[2], /Developers/, 'only this round\'s answers are sent');
  assert.doesNotMatch(a.prompts[2], /## Readiness gaps/, 'gaps are listed only once the interview is ending');
  assert.doesNotMatch(a.prompts[2], /Test-plan template/, 'tests are the plan stage, not the interview');
});

test('"y" accepts the proposed defaults; the log and the agent see the default as the answer', async () => {
  const { repo, config } = sandbox();
  const a = scripted(fullRounds);
  const o = owner(['desc', 'Y', 'Yes']);
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ask: o.ask, say: o.say, identity });
  assert.equal(res.status, 'ok');
  assert.match(readFileSync(join(repo, 'objective', 'CONVERSATION.md'), 'utf8'), /A1 \(default\): Yes/);
  assert.match(a.prompts[1], /Q1 \[Greeter\] Who uses the greeter\?: Yes/);
  assert.match(o.said[0], /y to accept all defaults/i);
});

test('each round has its own record and all rounds count toward the run budget', async () => {
  const { repo, config } = sandbox();
  await runObjective({ config, repoDir: repo, runId: 'r1', adapter: scripted(fullRounds).adapter, ...owner(['d', '1: a', '2: b']), identity });
  for (const d of ['interview', 'interview-2', 'interview-3']) assert.ok(existsSync(join(repo, 'runs', 'r1', d, 'record.json')), d);
  const t = sumRunUsage(repo, 'r1');
  assert.ok(t.seconds >= 0);
  assert.equal(t.iterations, 0, 'interview rounds are not iterations');
});

test('an empty answer pauses; rerunning re-asks the pending question and resumes numbering', async () => {
  const { repo, config } = sandbox();
  const a = scripted(fullRounds);
  const first = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ...owner(['desc', '']), identity });
  assert.equal(first.status, 'paused');
  assert.match(readFileSync(join(repo, 'objective', 'OPEN-QUESTIONS.md'), 'utf8'), /- \[ \] Q1 .*Who uses the greeter\?/, 'question kept for resume');
  assert.equal(git(repo, 'status', '--porcelain'), '');
  const o = owner(['1: Developers', '2: Yes']);
  const second = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ask: o.ask, say: o.say, identity });
  assert.deepEqual(second, { status: 'ok', rounds: 2 });
  assert.ok(!o.asked.some((p) => /Describe the objective/.test(p)), 'brief is not asked twice');
  assert.match(o.said[0], /Who uses the greeter/);
  assert.ok(existsSync(join(repo, 'runs', 'r1', 'interview-3', 'record.json')));
});

test('no description given is gated and calls no agent', async () => {
  const { repo, config } = sandbox();
  const a = scripted([]);
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ...owner(['   ']), identity });
  assert.equal(res.status, 'gated');
  assert.equal(a.prompts.length, 0);
});

test('a target without the kit is gated', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'obj-')), 'sb');
  initSandbox({ dir, adapter: 'a', model: 'm', seed: 'empty' });
  const config = { ...JSON.parse(readFileSync(join(dir, 'hodge.json'), 'utf8')) };
  const res = await runObjective({ config, repoDir: join(dir, 'target'), runId: 'r1', adapter: scripted([]).adapter, ...owner(['x']), identity });
  assert.equal(res.status, 'gated');
  assert.match(res.reason ?? '', /--seed objective/);
});

test('gaps but no question is stalled, not an endless loop', async () => {
  const { repo, config } = sandbox();
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: scripted([{ 'objective/notes.md': 'n\n' }, { 'objective/notes.md': 'm\n' }]).adapter, ...owner(['desc']), identity });
  assert.equal(res.status, 'stalled');
  assert.equal(res.rounds, 2);
});

test('gaps but no question retries once with the gaps in the prompt and can reach ok without asking the owner', async () => {
  const { repo, config } = sandbox();
  const a = scripted([
    { 'specs/greet.md': coarse },
    { 'specs/greet.md': goodSpec },
  ]);
  const o = owner(['desc']);
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ask: o.ask, say: o.say, identity });
  assert.deepEqual(res, { status: 'ok', rounds: 2 });
  assert.equal(o.asked.length, 1);
  assert.match(a.prompts[1], /## Stage: fine/);
  assert.match(a.prompts[1], /## Readiness gaps[\s\S]*2 requirements/, 'a claim with gaps starts the closing rounds');
});

test('stops after maxRounds', async () => {
  const { repo, config } = sandbox();
  const rounds = [1, 2, 3, 4].map((n) => ({ 'objective/RESPONSE.json': resp(n > 1 ? [n - 1] : [], [`q${n}?`]) }));
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: scripted(rounds).adapter, ...owner(['desc', '1: a', '2: b', '3: c']), maxRounds: 2, identity });
  assert.equal(res.status, 'max-rounds');
  assert.equal(res.rounds, 2);
});

test('spec problems come back as the next round gaps; the work is kept, not discarded', async () => {
  const { repo, config } = sandbox();
  const a = scripted([{ 'specs/greet.md': 'no title\n' }, { 'specs/greet.md': goodSpec }]);
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ...owner(['desc']), identity });
  assert.deepEqual(res, { status: 'ok', rounds: 2 });
  assert.match(a.prompts[1], /must start with a "# Spec: <name>" title/);
});

test('writing tests during the interview fails the round: tests belong to the plan stage', async () => {
  const { repo, config } = sandbox();
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: scripted([{ 'tests/greet.test.js': 'x\n' }]).adapter, ...owner(['desc']), identity });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /tests\/greet\.test\.js/);
});

test('rounds with a question never run readiness; "done" ends the interview and lists the gaps', async () => {
  const { repo, config } = sandbox();
  const a = scripted([
    { 'specs/greet.md': coarse, 'objective/RESPONSE.json': resp([], ['Should names be trimmed?']) },
    { 'specs/greet.md': goodSpec, 'objective/RESPONSE.json': resp([1]) },
  ]);
  const o = owner(['desc', 'done']);
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ask: o.ask, say: o.say, identity });
  assert.deepEqual(res, { status: 'ok', rounds: 2 });
  assert.match(o.said[0], /done to accept every remaining default/i);
  assert.match(a.prompts[1], /Q1 \[Greeter\] Should names be trimmed\?: Yes/, 'done accepts the defaults');
  assert.doesNotMatch(a.prompts[0], /## Readiness gaps/);
  assert.match(a.prompts[1], /## Readiness gaps[\s\S]*2 requirements/);
  const rec = JSON.parse(readFileSync(join(repo, 'runs', 'r1', 'interview', 'record.json'), 'utf8'));
  assert.equal(rec.status, 'incomplete');
  assert.match(rec.reason, /waiting for the owner/);
  assert.match(readFileSync(join(repo, 'objective', 'CONVERSATION.md'), 'utf8'), /Ended the interview/);
});

test('"done" is remembered: a resumed conversation keeps closing', async () => {
  const { repo, config } = sandbox();
  const a = scripted([
    { 'specs/greet.md': coarse, 'objective/RESPONSE.json': resp([], ['Should names be trimmed?']) },
    { 'specs/greet.md': coarse, 'objective/RESPONSE.json': resp([1], ['Trim names?']) },
    { 'specs/greet.md': goodSpec, 'objective/RESPONSE.json': resp([2]) },
  ]);
  await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ...owner(['desc', 'done', '']), identity });
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ...owner(['y']), identity });
  assert.equal(res.status, 'ok');
  assert.match(a.prompts[2], /## Readiness gaps/);
});

test('hodge --dir drives the conversation from stdin', async () => {
  const { dir } = sandbox();
  const a = scripted(fullRounds);
  /** @type {string[]} */
  const outs = [];
  const code = await main(['hodge', '--dir', dir], {
    stdout: (s) => outs.push(s),
    stderr: (s) => outs.push(s),
    input: Readable.from(['A greeter\n1: Developers\n2: Yes\n']),
    registry: { a: () => a.adapter },
    identity,
  });
  const text = outs.join('');
  assert.equal(code, 0, text);
  assert.match(text, /Describe the objective/);
  assert.match(text, /Who uses the greeter\?/);
  assert.match(text, /"status":"ok"/);
});

test('code owns the store: agent edits to OPEN-QUESTIONS.md, CONVERSATION.md and QUESTION.md are discarded', async () => {
  const { repo, config } = sandbox();
  const a = scripted([
    { 'objective/RESPONSE.json': resp([], ['Who uses the greeter?']), 'objective/OPEN-QUESTIONS.md': '# hacked\n', 'objective/CONVERSATION.md': 'x\n', 'objective/QUESTION.md': 'Free?\n' },
    { 'specs/greet.md': goodSpec, 'objective/RESPONSE.json': resp([1]) },
  ]);
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ...owner(['desc', 'y']), identity });
  assert.equal(res.status, 'ok');
  assert.ok(!existsSync(join(repo, 'objective', 'QUESTION.md')));
  assert.ok(!existsSync(join(repo, 'objective', 'RESPONSE.json')), 'the response is consumed, not committed');
  assert.doesNotMatch(readFileSync(join(repo, 'objective', 'OPEN-QUESTIONS.md'), 'utf8'), /hacked/);
  assert.doesNotMatch(readFileSync(join(repo, 'objective', 'CONVERSATION.md'), 'utf8'), /^x$/m);
});

test('an invalid response keeps the round, leaves the answers pending and is reported to the next round', async () => {
  const { repo, config } = sandbox();
  const a = scripted([
    { 'objective/RESPONSE.json': resp([], ['Who uses the greeter?']) },
    { 'specs/greet.md': goodSpec, 'objective/RESPONSE.json': '{"resolved":[{"id":7,"spec":"s"}],"gaps":[]}' },
    { 'objective/RESPONSE.json': resp([1]) },
  ]);
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ...owner(['desc', 'Y']), identity });
  assert.equal(res.status, 'ok', JSON.stringify(res));
  assert.match(a.prompts[2], /invalid objective\/RESPONSE\.json: resolved id 7 was not answered/);
  assert.match(a.prompts[2], /Q1 \[Greeter\] Who uses the greeter\?: Yes/, 'the answers are sent again');
  assert.ok(existsSync(join(repo, 'specs', 'greet.md')), 'work is kept');
});
