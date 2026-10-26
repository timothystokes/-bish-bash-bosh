import { Readable } from 'node:stream';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInterview, buildInterviewPrompt } from '../src/interview.js';
import { loadModePrompt } from '../src/prompts.js';
import { main } from '../src/cli.js';
import { lintSpecs } from '../src/spec-lint.js';
import { sandboxOf } from './support/sandbox.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-int-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  writeFileSync(join(dir, 'README.md'), '# target\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const config = (/** @type {Record<string, {adapter: string, model: string}>} */ roles = { interview: { adapter: 'f', model: 'm' } }) => ({
  targetRepo: 'git@example.com:o/target.git',
  roles: { build: { adapter: 'f', model: 'm' }, ...roles },
  budgets: { maxTokens: 1000, maxCostUsd: 5, maxWallClockSeconds: 60, maxIterations: 5 },
  allowedPaths: ['src/'],
});

const identity = { root: '/nonexistent/hodgepodge', remotes: [] };

const goodWrites = {
  'specs/greet.md': '# Spec: Greeter\n\n## Requirements\n- must greet\n',
  'tests/PLAN.md': '| Spec | Tests |\n|---|---|\n| specs/greet.md | tests/greet.test.js |\n',
  'tests/greet.test.js': 'throw new Error("red");\n',
};

/** @param {Record<string, string>} writes @param {number} [exitStatus] */
const agent = (writes, exitStatus = 0) => {
  /** @type {string[]} */
  const prompts = [];
  return {
    prompts,
    adapter: {
      /** @param {import('../src/adapter.js').AdapterRequest} req */
      async run(req) {
        prompts.push(req.prompt);
        const { createFakeAdapter } = await import('../src/adapter.js');
        return createFakeAdapter({ exitStatus, transcript: 't', usage: { tokens: 5, cost: 0.1 }, writes }).run(req);
      },
    },
  };
};

test('interview prompt exists, carries the objective, both templates and the lint rules', () => {
  assert.match(loadModePrompt('interview'), /one spec per file/i);
  const dir = makeRepo();
  const p = buildInterviewPrompt(dir, 'Build a greeter');
  assert.match(p, /Build a greeter/);
  assert.match(p, /# Spec: <name/);
  assert.match(p, /\| Spec \| Tests \|/);
});

test('a lint-clean interview is committed with a record', async () => {
  const dir = makeRepo();
  const a = agent(goodWrites);
  const res = await runInterview({ config: config(), repoDir: dir, runId: 'r1', adapter: a.adapter, objective: 'Build a greeter', identity });
  assert.equal(res.status, 'ok');
  assert.equal(res.sha, git(dir, 'rev-parse', 'HEAD'));
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(lintSpecs(dir).ok, true);
  assert.ok(existsSync(join(dir, 'runs', 'r1', 'interview', 'record.json')));
  assert.equal(JSON.parse(readFileSync(join(dir, 'runs', 'r1', 'interview', 'record.json'), 'utf8')).status, 'ok');
  assert.match(a.prompts[0], /Build a greeter/);
});

test('refuses to finish when spec-lint fails: work discarded, problems reported', async () => {
  const dir = makeRepo();
  const res = await runInterview({
    config: config(),
    repoDir: dir,
    runId: 'r1',
    adapter: agent({ 'specs/bad.md': 'no title\n', 'tests/PLAN.md': '| Spec | Tests |\n' }).adapter,
    objective: 'x',
    identity,
  });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /spec-lint failed/);
  assert.equal(existsSync(join(dir, 'specs')), false);
  assert.equal(JSON.parse(readFileSync(join(dir, 'runs', 'r1', 'interview', 'record.json'), 'utf8')).status, 'failed');
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('refuses when the agent writes outside specs/ and tests/', async () => {
  const dir = makeRepo();
  const res = await runInterview({
    config: config(),
    repoDir: dir,
    runId: 'r1',
    adapter: agent({ ...goodWrites, 'src/app.js': 'x\n' }).adapter,
    objective: 'x',
    identity,
  });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /src\/app\.js/);
  assert.equal(existsSync(join(dir, 'src')), false);
});

test('agent failure is failed and discarded', async () => {
  const dir = makeRepo();
  const res = await runInterview({ config: config(), repoDir: dir, runId: 'r1', adapter: agent(goodWrites, 1).adapter, objective: 'x', identity });
  assert.equal(res.status, 'failed');
  assert.equal(existsSync(join(dir, 'specs')), false);
});

test('gates: empty objective, dirty tree, harness repo, missing role make no agent call', async () => {
  const dir = makeRepo();
  const a = agent(goodWrites);
  const base = { config: config(), repoDir: dir, runId: 'r1', adapter: a.adapter, identity };
  assert.equal((await runInterview({ ...base, objective: '  ' })).status, 'gated');
  writeFileSync(join(dir, 'dirty.txt'), 'x');
  assert.match((await runInterview({ ...base, objective: 'x' })).reason ?? '', /not clean/);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'clean');
  const self = await runInterview({ ...base, objective: 'x', identity: { root: dir, remotes: [] } });
  assert.equal(self.status, 'gated');
  assert.equal(a.prompts.length, 0);
});

test('hodge on a repo without a kit scaffolds objective/ and keeps asking until ready', async () => {
  const dir = makeRepo();
  const cfgPath = join(tmpdir(), `hodge-int-cfg-${Date.now()}.json`);
  writeFileSync(cfgPath, JSON.stringify(config({ interview: { adapter: 'iv', model: 'm' } })));
  const out = /** @type {string[]} */ ([]);
  /** @type {Record<string, string>[]} */
  const rounds = [
    { 'objective/QUESTION.md': 'Who uses the greeter?\n' },
    { 'objective/QUESTION.md': 'Should names be trimmed?\n', 'objective/notes.md': 'n\n' },
    { 'objective/QUESTION.md': 'Anything out of scope?\n', 'objective/notes.md': 'm\n' },
  ];
  const prompts = /** @type {string[]} */ ([]);
  let n = 0;
  const adapter = {
    /** @param {import('../src/adapter.js').AdapterRequest} req */
    async run(req) {
      prompts.push(req.prompt);
      const { createFakeAdapter } = await import('../src/adapter.js');
      return createFakeAdapter({ exitStatus: 0, transcript: 't', usage: { tokens: 5, cost: 0.1 }, writes: rounds[n++] ?? {} }).run(req);
    },
  };
  const code = await main(['hodge', '--dir', sandboxOf(cfgPath, dir)], {
    registry: { iv: () => adapter, f: () => { throw new Error('build role must not be used'); } },
    identity,
    input: Readable.from(['Build a greeter\n', 'Developers\n', 'Yes\n', '']),
    stdout: (s) => { out.push(s); }, stderr: () => {},
  });
  assert.ok(existsSync(join(dir, 'objective', 'INTERVIEW.md')), 'kit scaffolded');
  assert.equal(code, 1, 'paused at EOF, not ok');
  assert.ok(n >= 3, `agent ran once per answer, ran ${n} times`);
  assert.match(out.join(''), /Who uses the greeter\?[\s\S]*Should names be trimmed\?[\s\S]*Anything out of scope\?/);
  assert.match(prompts[1], /Developers/);
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), '# target\n');
});

test('hodge usage errors exit 2', async () => {
  const err = /** @type {string[]} */ ([]);
  const e = (/** @type {string} */ s) => { err.push(s); };
  assert.equal(await main(['hodge', '--dir', '/nonexistent/sandbox'], { stdout: () => {}, stderr: e }), 2);
  assert.match(err.join(''), /hodge\.json/);

  const cfgPath = join(tmpdir(), `hodge-int-norole-${Date.now()}.json`);
  writeFileSync(cfgPath, JSON.stringify(config({})));
  err.length = 0;
  assert.equal(await main(['hodge', '--dir', sandboxOf(cfgPath)], { registry: { f: () => agent({}).adapter }, stdout: () => {}, stderr: e }), 2);
  assert.match(err.join(''), /no role 'interview'/);

  err.length = 0;
  assert.equal(await main(['step', '--dir', sandboxOf(cfgPath), '--objective', 'x'], { stdout: () => {}, stderr: e }), 2);
});

test('readlineOptions: a TTY input gets terminal mode so Enter submits; piped input stays plain', async () => {
  const { readlineOptions } = await import('../src/cli.js');
  const tty = Object.assign(new Readable({ read() {} }), { isTTY: true });
  assert.equal(readlineOptions(tty).terminal, true);
  assert.ok(readlineOptions(tty).output);
  assert.equal(readlineOptions(Readable.from([])).terminal, undefined);
});
