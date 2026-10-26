import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLoop, isPlanDone } from '../src/driver.js';
import { main } from '../src/cli.js';
import { createFakeAdapter } from '../src/adapter.js';
import { validateConfig } from '../src/config.js';
import { sandboxOf } from './support/sandbox.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

/** @param {string} plan */
function makeRepo(plan) {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-drv-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  mkdirSync(join(dir, 'specs'));
  writeFileSync(join(dir, 'specs', 'a.md'), '# Spec A\n');
  writeFileSync(join(dir, 'plan.md'), plan);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const config = (maxIterations = 5) => ({
  targetRepo: 'git@example.com:o/target.git',
  roles: { build: { adapter: 'f', model: 'm' } },
  budgets: { maxTokens: 1000, maxCostUsd: 1, maxWallClockSeconds: 60, maxIterations },
  allowedPaths: ['src/'],
});
const identity = { root: '/nonexistent/hodgepodge', remotes: [] };
const pass = ['node', '-e', 'process.exit(0)'];

test('isPlanDone: needs at least one checkbox and none unchecked', () => {
  assert.equal(isPlanDone('# p\n- [x] a\n- [x] b\n'), true);
  assert.equal(isPlanDone('- [x] a\n- [ ] b\n'), false);
  assert.equal(isPlanDone('# no items\n'), false);
});

test('runLoop stops with done when the agent ticks the last plan item', async () => {
  const dir = makeRepo('- [ ] one\n- [ ] two\n');
  let n = 0;
  const adapter = {
    async run(/** @type {any} */ req) {
      n += 1;
      const plan = n === 1 ? '- [x] one\n- [ ] two\n' : '- [x] one\n- [x] two\n';
      writeFileSync(join(req.cwd, 'plan.md'), plan);
      mkdirSync(join(req.cwd, 'src'), { recursive: true });
      writeFileSync(join(req.cwd, 'src', `f${n}.txt`), 'x');
      return { exitStatus: 0, transcript: 't', usage: { tokens: 1, cost: 0.1 }, changedFiles: ['plan.md'] };
    },
  };
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity });
  assert.equal(res.status, 'done');
  assert.equal(res.steps.length, 2);
  assert.deepEqual(res.steps.map((s) => s.iteration), [1, 2]);
});

test('runLoop stops over-budget when iterations are exhausted', async () => {
  const dir = makeRepo('- [ ] one\n');
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 't', usage: { tokens: 1, cost: 0.1 }, writes: {} });
  const res = await runLoop({ config: config(2), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity });
  assert.equal(res.status, 'over-budget');
  assert.equal(res.steps.filter((s) => s.status === 'ok').length, 2);
  assert.ok(res.reason);
});

test('runLoop stops on the first failed step without retrying', async () => {
  const dir = makeRepo('- [ ] one\n');
  const adapter = createFakeAdapter({ exitStatus: 1, transcript: 'no', usage: { tokens: 1, cost: 0 }, writes: {} });
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity });
  assert.equal(res.status, 'failed');
  assert.equal(res.steps.length, 1);
});

test('runLoop stops on a gated step', async () => {
  const dir = makeRepo('- [ ] one\n');
  writeFileSync(join(dir, 'dirty.txt'), 'x');
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 't', usage: { tokens: 1, cost: 0 }, writes: {} });
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity });
  assert.equal(res.status, 'gated');
  assert.equal(res.steps.length, 1);
});

test('runLoop with requireTestPlan gates when tests/PLAN.md is missing', async () => {
  const dir = makeRepo('- [ ] one\n');
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 't', usage: { tokens: 1, cost: 0 }, writes: {} });
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity, requireTestPlan: true });
  assert.equal(res.status, 'gated');
});

test('runLoop with requireTestPlan refuses to start when spec-lint fails, without calling the agent', async () => {
  const dir = makeRepo('- [ ] one\n');
  let called = false;
  const adapter = { async run() { called = true; return { exitStatus: 0, transcript: 't', usage: { tokens: 1, cost: 0 }, changedFiles: [] }; } };
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity, requireTestPlan: true });
  assert.equal(res.status, 'gated');
  assert.deepEqual(res.steps, []);
  assert.match(res.reason ?? '', /spec-lint/);
  assert.equal(called, false);
});

test('runLoop without requireTestPlan does not run spec-lint', async () => {
  const dir = makeRepo('- [x] one\n');
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 't', usage: { tokens: 1, cost: 0 }, writes: {} });
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity });
  assert.notEqual(res.status, 'gated');
});

test('config accepts optional requireTestPlan boolean', () => {
  assert.equal(validateConfig({ ...config(), requireTestPlan: true }).ok, true);
  assert.equal(validateConfig({ ...config(), requireTestPlan: 'yes' }).ok, false);
});

test('podge prints loop JSON, exit 0 when done, 1 otherwise', async () => {
  const dir = makeRepo('- [ ] one\n');
  const cfgPath = join(tmpdir(), `hodge-run-cfg-${Date.now()}.json`);
  writeFileSync(cfgPath, JSON.stringify(config(2)));
  const out = /** @type {string[]} */ ([]);
  const code = await main(['podge', '--dir', sandboxOf(cfgPath, dir), '--run-id', 'r'], {
    registry: { f: () => createFakeAdapter({ exitStatus: 0, transcript: 't', usage: { tokens: 1, cost: 0.1 }, writes: {} }) },
    testCommand: pass,
    identity,
    stdout: (s) => { out.push(s); },
    stderr: () => {},
  });
  assert.equal(code, 1);
  const res = JSON.parse(out.join(''));
  assert.equal(res.status, 'over-budget');
  assert.equal(res.steps.length, 3);
});

test('podge reports usage errors with exit 2', async () => {
  const err = /** @type {string[]} */ ([]);
  const code = await main(['podge'], { stdout: () => {}, stderr: (s) => { err.push(s); } });
  assert.equal(code, 2);
  assert.match(err.join(''), /podge: cannot read config .*hodge\.json/);
});
