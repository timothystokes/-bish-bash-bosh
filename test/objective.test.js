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

## Requirements
- \`greet(name)\` must return "Hello, name!".
- \`greet\` must throw a TypeError when name is not a string.
- \`greet\` must trim surrounding whitespace from name.

## Examples
- \`greet('Ann')\` -> \`Hello, Ann!\`
- \`greet(1)\` -> throws TypeError

## Out of scope
- Localisation.
`;
const coarse = goodSpec.replace(/- `greet` must trim.*\n/, '');
const plan = '| Spec | Tests |\n|---|---|\n| specs/greet.md | tests/greet.test.js |\n';

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
        return { transcript: 't', usage: { tokens: 10, cost: 0.1 }, exitStatus: 0, changedFiles: Object.keys(writes) };
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

/** @type {Record<string, string | null>[]} */
const fullRounds = [
  { 'objective/QUESTION.md': 'Who uses the greeter?\n', 'objective/notes.md': 'n\n' },
  { 'specs/greet.md': coarse, 'tests/PLAN.md': plan, 'tests/greet.test.js': 'x\n', 'objective/QUESTION.md': 'Should names be trimmed?\n' },
  { 'specs/greet.md': goodSpec, 'objective/QUESTION.md': null },
];

test('asks for the description first, then alternates rounds and answers broad to fine until ready', async () => {
  const { repo, config } = sandbox();
  const a = scripted(fullRounds);
  const o = owner(['A greeter library for Ann', 'Developers', 'Yes, trim']);
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ask: o.ask, say: o.say, identity });
  assert.deepEqual(res, { status: 'ok', rounds: 3 });
  assert.match(o.asked[0], /Describe the objective/);
  assert.deepEqual(o.said.map((t) => t.trim()), ['Who uses the greeter?', 'Should names be trimmed?']);
  assert.match(readFileSync(join(repo, 'objective', 'BRIEF.md'), 'utf8'), /A greeter library for Ann/);
  const convo = readFileSync(join(repo, 'objective', 'CONVERSATION.md'), 'utf8');
  assert.match(convo, /Who uses the greeter\?[\s\S]*Developers/);
  assert.match(convo, /Should names be trimmed\?[\s\S]*Yes, trim/);
  assert.ok(!existsSync(join(repo, 'objective', 'QUESTION.md')));
  assert.equal(git(repo, 'status', '--porcelain'), '');
  // stage and context progress across rounds
  assert.match(a.prompts[0], /## Stage: broad/);
  assert.match(a.prompts[0], /A greeter library for Ann/);
  assert.match(a.prompts[1], /## Stage: broad/);
  assert.match(a.prompts[1], /Developers/);
  assert.match(a.prompts[2], /## Stage: fine/);
  assert.match(a.prompts[2], /Yes, trim/);
  assert.match(a.prompts[2], /2 requirements/);
});

test('each round has its own record and all rounds count toward the run budget', async () => {
  const { repo, config } = sandbox();
  await runObjective({ config, repoDir: repo, runId: 'r1', adapter: scripted(fullRounds).adapter, ...owner(['d', 'a', 'b']), identity });
  for (const d of ['interview', 'interview-2', 'interview-3']) assert.ok(existsSync(join(repo, 'runs', 'r1', d, 'record.json')), d);
  const t = sumRunUsage(repo, 'r1');
  assert.equal(t.tokens, 30);
  assert.ok(Math.abs(t.cost - 0.3) < 1e-9);
});

test('an empty answer pauses; rerunning re-asks the pending question and resumes numbering', async () => {
  const { repo, config } = sandbox();
  const a = scripted(fullRounds);
  const first = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: a.adapter, ...owner(['desc', '']), identity });
  assert.equal(first.status, 'paused');
  assert.ok(existsSync(join(repo, 'objective', 'QUESTION.md')), 'question kept for resume');
  assert.equal(git(repo, 'status', '--porcelain'), '');
  const o = owner(['Developers', 'Yes']);
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
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: scripted([{ 'objective/notes.md': 'n\n' }]).adapter, ...owner(['desc']), identity });
  assert.equal(res.status, 'stalled');
  assert.equal(res.rounds, 1);
});

test('stops after maxRounds', async () => {
  const { repo, config } = sandbox();
  const rounds = [1, 2, 3, 4].map((n) => ({ 'objective/QUESTION.md': `q${n}\n` }));
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: scripted(rounds).adapter, ...owner(['desc', 'a', 'b', 'c']), maxRounds: 2, identity });
  assert.equal(res.status, 'max-rounds');
  assert.equal(res.rounds, 2);
});

test('a failed round (spec-lint) ends the conversation with the reason', async () => {
  const { repo, config } = sandbox();
  const res = await runObjective({ config, repoDir: repo, runId: 'r1', adapter: scripted([{ 'specs/bad.md': 'no title\n' }]).adapter, ...owner(['desc']), identity });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /spec-lint failed/);
});

test('hodge --dir drives the conversation from stdin', async () => {
  const { dir } = sandbox();
  const a = scripted(fullRounds);
  /** @type {string[]} */
  const outs = [];
  const code = await main(['hodge', '--dir', dir], {
    stdout: (s) => outs.push(s),
    stderr: (s) => outs.push(s),
    input: Readable.from(['A greeter\nDevelopers\nYes\n']),
    registry: { a: () => a.adapter },
    identity,
  });
  const text = outs.join('');
  assert.equal(code, 0, text);
  assert.match(text, /Describe the objective/);
  assert.match(text, /Who uses the greeter\?/);
  assert.match(text, /"status":"ok"/);
});
