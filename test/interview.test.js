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

test('hodge interview uses the interview role and exits 0 only when lint-clean', async () => {
  const dir = makeRepo();
  const cfgPath = join(tmpdir(), `hodge-int-cfg-${Date.now()}.json`);
  writeFileSync(cfgPath, JSON.stringify(config({ interview: { adapter: 'iv', model: 'm' } })));
  const out = /** @type {string[]} */ ([]);
  const registry = { iv: () => agent(goodWrites).adapter, f: () => { throw new Error('build role must not be used'); } };
  const code = await main(['interview', '--config', cfgPath, '--repo', dir, '--objective', 'Build a greeter'], {
    registry, identity, stdout: (s) => { out.push(s); }, stderr: () => {},
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out.join('')).status, 'ok');

  const dir2 = makeRepo();
  out.length = 0;
  const bad = await main(['interview', '--config', cfgPath, '--repo', dir2, '--objective', 'x'], {
    registry: { iv: () => agent({ 'specs/bad.md': 'x\n' }).adapter }, identity, stdout: (s) => { out.push(s); }, stderr: () => {},
  });
  assert.equal(bad, 1);
});

test('hodge interview usage errors exit 2', async () => {
  const err = /** @type {string[]} */ ([]);
  const e = (/** @type {string} */ s) => { err.push(s); };
  assert.equal(await main(['interview', '--config', 'x.json'], { stdout: () => {}, stderr: e }), 2);
  assert.match(err.join(''), /--objective/);

  const cfgPath = join(tmpdir(), `hodge-int-norole-${Date.now()}.json`);
  writeFileSync(cfgPath, JSON.stringify(config({})));
  err.length = 0;
  assert.equal(await main(['interview', '--config', cfgPath, '--objective', 'x'], { registry: { f: () => agent({}).adapter }, stdout: () => {}, stderr: e }), 2);
  assert.match(err.join(''), /no role 'interview'/);

  err.length = 0;
  assert.equal(await main(['step', '--config', cfgPath, '--objective', 'x'], { stdout: () => {}, stderr: e }), 2);
});
