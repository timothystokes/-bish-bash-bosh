import { Readable } from 'node:stream';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInterview, buildInterviewPrompt } from '../src/hodge-interview.js';
import { loadModePrompt } from '../src/prompts.js';
import { main } from '../src/cli.js';
import { lintSpecs } from '../src/spec-lint.js';
import { writeProjectConfig, commitProjectConfig, withCwd } from './support/project.js';

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
  roles: { build: { adapter: 'f', model: 'm' }, ...roles },
  budgets: { maxWallClockSeconds: 60, maxIterations: 5 },
  allowedPaths: ['src/'],
});

const identity = { root: '/nonexistent/hodgepodge', remotes: [] };

const goodWrites = {
  'specs/greet.md': '# Spec: Greeter\nImplementation: none\n\n## Requirements\n- R-greet-1: must greet\n',
};

/** @param {Record<string, string>} writes @param {number} [exitStatus] */
const agent = (writes, exitStatus = 0) => {
  /** @type {string[]} */
  const prompts = [];
  return {
    prompts,
    adapter: {
      async run(req) {
        prompts.push(req.prompt);
        const { createFakeAdapter } = await import('../src/adapter.js');
        return createFakeAdapter({ exitStatus, transcript: 't', writes }).run(req);
      },
    },
  };
};

test('interview prompt exists, carries the objective and the spec template, not the test-plan template', () => {
  assert.match(loadModePrompt('interview'), /one spec per file/i);
  const dir = makeRepo();
  const p = buildInterviewPrompt(dir, 'Build a greeter');
  assert.match(p, /Build a greeter/);
  assert.match(p, /# Spec: <name/);
  assert.doesNotMatch(p, /\| Spec \| Tests \|/);
  assert.doesNotMatch(loadModePrompt('interview'), /write tests\/PLAN\.md/i);
});

test('a single-shot interview (no question left) that is lint-clean is committed with a record', async () => {
  const dir = makeRepo();
  const a = agent(goodWrites);
  const res = await runInterview({ config: config(), repoDir: dir, runId: 'r1', adapter: a.adapter, objective: 'Build a greeter', identity });
  assert.equal(res.status, 'ok');
  assert.equal(res.sha, git(dir, 'rev-parse', 'HEAD'));
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(lintSpecs(dir, { testPlan: false }).ok, true);
  assert.ok(existsSync(join(dir, 'runs', 'r1', 'interview', 'record.json')));
  assert.equal(JSON.parse(readFileSync(join(dir, 'runs', 'r1', 'interview', 'record.json'), 'utf8')).status, 'ok');
  assert.match(a.prompts[0], /Build a greeter/);
});

test('spec-lint problems at the end of the interview keep the work and are reported as gaps', async () => {
  const dir = makeRepo();
  const res = await runInterview({
    config: config(),
    repoDir: dir,
    runId: 'r1',
    adapter: agent({ 'specs/bad.md': 'no title\n' }).adapter,
    objective: 'x',
    identity,
  });
  assert.equal(res.status, 'incomplete');
  assert.match(res.reason ?? '', /must start with a "# Spec: <name>" title/);
  assert.equal(existsSync(join(dir, 'specs', 'bad.md')), true);
  assert.equal(JSON.parse(readFileSync(join(dir, 'runs', 'r1', 'interview', 'record.json'), 'utf8')).status, 'incomplete');
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('the test-plan mapping is not an interview check: specs without tests/PLAN.md are lint-clean for the interview', async () => {
  const dir = makeRepo();
  const res = await runInterview({ config: config(), repoDir: dir, runId: 'r1', adapter: agent(goodWrites).adapter, objective: 'x', identity });
  assert.equal(res.status, 'ok');
  assert.equal(existsSync(join(dir, 'tests')), false);
  assert.equal(lintSpecs(dir).ok, false, 'the full lint (plan stage) still needs the mapping');
  assert.equal(lintSpecs(dir, { testPlan: false }).ok, true);
});

test('refuses when the agent writes outside specs/ and objective/ (tests are the plan stage)', async () => {
  const dir = makeRepo();
  const res = await runInterview({
    config: config(),
    repoDir: dir,
    runId: 'r1',
    adapter: agent({ ...goodWrites, 'src/app.js': 'x\n', 'tests/a.test.js': 'x\n' }).adapter,
    objective: 'x',
    identity,
  });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /src\/app\.js.*tests\/a\.test\.js|tests\/a\.test\.js.*src\/app\.js/);
  assert.equal(existsSync(join(dir, 'src')), false);
});

test('agent failure is failed and discarded', async () => {
  const dir = makeRepo();
  const res = await runInterview({ config: config(), repoDir: dir, runId: 'r1', adapter: agent(goodWrites, 1).adapter, objective: 'x', identity });
  assert.equal(res.status, 'failed');
  assert.equal(existsSync(join(dir, 'specs')), false);
});

test('an agent that exits 0 but changes nothing is failed, not ok', async () => {
  const dir = makeRepo();
  const res = await runInterview({ config: config(), repoDir: dir, runId: 'r1', adapter: agent({}).adapter, objective: 'x', identity });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /no changes/);
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

const gaps = (/** @type {number[]} */ resolved, /** @type {string} */ question) =>
  JSON.stringify({ resolved: resolved.map((id) => ({ id, spec: 'specs/greet.md' })), gaps: [{ topic: 'Greeter', question, default: 'Yes' }] });

test('hodge on a repo without a kit scaffolds objective/ and keeps asking until ready', async () => {
  const dir = makeRepo();
  commitProjectConfig(dir, config({ interview: { adapter: 'iv', model: 'm' } }));
  const out = /** @type {string[]} */ ([]);
  /** @type {Record<string, string>[]} */
  const rounds = [
    { 'objective/RESPONSE.json': gaps([], 'Who uses the greeter?') },
    { 'objective/RESPONSE.json': gaps([2], 'Should names be trimmed?'), 'objective/notes.md': 'n\n' },
    { 'objective/RESPONSE.json': gaps([3], 'Anything out of scope?'), 'objective/notes.md': 'm\n' },
  ];
  const prompts = /** @type {string[]} */ ([]);
  let n = 0;
  const adapter = {
    async run(req) {
      prompts.push(req.prompt);
      const { createFakeAdapter } = await import('../src/adapter.js');
      return createFakeAdapter({ exitStatus: 0, transcript: 't', writes: rounds[n++] ?? {} }).run(req);
    },
  };
  const code = await withCwd(dir, () =>
    main(['hodge'], {
      registry: { iv: () => adapter, f: () => { throw new Error('build role must not be used'); } },
      identity,
      input: Readable.from(['Build a greeter\n', 'y\n', 'y\n', '']),
      stdout: (s) => { out.push(s); }, stderr: () => {},
    }));
  assert.ok(existsSync(join(dir, 'objective', 'INTERVIEW.md')), 'kit scaffolded');
  assert.equal(code, 1, 'paused at EOF, not ok');
  assert.ok(n >= 3, `agent ran once per answer, ran ${n} times`);
  assert.match(out.join(''), /Who uses the greeter\?[\s\S]*Should names be trimmed\?[\s\S]*Anything out of scope\?/);
  assert.match(prompts[1], /Q2 \[Greeter\] Who uses the greeter\?: Yes/);
  assert.equal(git(dir, 'status', '--porcelain', '--', '.', ':!.hodge.lock'), '');
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), '# target\n');
});

test('hodge usage errors exit 2', async () => {
  const err = /** @type {string[]} */ ([]);
  const e = (/** @type {string} */ s) => { err.push(s); };
  const missing = mkdtempSync(join(tmpdir(), 'hodge-int-missing-'));
  assert.equal(await withCwd(missing, () => main(['hodge'], { stdout: () => {}, stderr: e })), 2);
  assert.match(err.join(''), /hodgepodge\.yml/);

  const norole = mkdtempSync(join(tmpdir(), 'hodge-int-norole-'));
  writeProjectConfig(norole, config({}));
  err.length = 0;
  assert.equal(await withCwd(norole, () => main(['hodge'], { registry: { f: () => agent({}).adapter }, stdout: () => {}, stderr: e })), 2);
  assert.match(err.join(''), /no role 'interview'/);

  err.length = 0;
  assert.equal(await withCwd(norole, () => main(['podge', 'step', '--objective', 'x'], { stdout: () => {}, stderr: e })), 2);
});

test('readlineOptions: a TTY input gets terminal mode so Enter submits; piped input stays plain', async () => {
  const { readlineOptions } = await import('../src/cli.js');
  const tty = Object.assign(new Readable({ read() {} }), { isTTY: true });
  assert.equal(readlineOptions(tty).terminal, true);
  assert.ok(readlineOptions(tty).output);
  assert.equal(readlineOptions(Readable.from([])).terminal, undefined);
});
