import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLoop, isPlanDone } from '../src/podge-driver.js';
import { main } from '../src/cli.js';
import { createFakeAdapter } from '../src/adapter.js';
import { validateConfig } from '../src/config.js';
import { writeProjectConfig, commitProjectConfig, withCwd } from './support/project.js';

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

const config = () => ({
  adapter: 'f', model: 'm',
});
const identity = { root: '/nonexistent/hodgepodge', remotes: [] };
const pass = ['node', '-e', 'process.exit(0)'];

test('isPlanDone: needs at least one checkbox and none unchecked', () => {
  assert.equal(isPlanDone('# p\n- [x] a\n- [x] b\n'), true);
  assert.equal(isPlanDone('- [x] a\n- [ ] b\n'), false);
  assert.equal(isPlanDone('# no items\n'), false);
});

test('runLoop stops gated when the agent records an unresolved CONFLICT item in plan.md', async () => {
  const dir = makeRepo('- [ ] one\n- [ ] two\n');
  let n = 0;
  const adapter = {
    async run(/** @type {any} */ req) {
      n += 1;
      writeFileSync(join(req.cwd, 'plan.md'), '- [ ] one\n- [ ] two\n\n- [ ] CONFLICT: specs/a.md:2 vs tests/a.test.js:3\n');
      return { exitStatus: 0, transcript: 't', changedFiles: ['plan.md'] };
    },
  };
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity });
  assert.equal(res.status, 'gated');
  assert.match(res.reason ?? '', /CONFLICT/);
  assert.equal(n, 1, 'no further iterations are spent on a conflict');
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
      return { exitStatus: 0, transcript: 't', changedFiles: ['plan.md'] };
    },
  };
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity });
  assert.equal(res.status, 'done');
  assert.equal(res.steps.length, 2);
  assert.deepEqual(res.steps.map((s) => s.iteration), [1, 2]);
});

test('runLoop stops on the first failed step without retrying', async () => {
  const dir = makeRepo('- [ ] one\n');
  const adapter = createFakeAdapter({ exitStatus: 1, transcript: 'no', writes: {} });
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity });
  assert.equal(res.status, 'failed');
  assert.equal(res.steps.length, 1);
});

test('runLoop stops on a gated step', async () => {
  const dir = makeRepo('- [ ] one\n');
  writeFileSync(join(dir, 'dirty.txt'), 'x');
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 't', writes: {} });
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity });
  assert.equal(res.status, 'gated');
  assert.equal(res.steps.length, 1);
});

test('runLoop with requireTestPlan gates when tests/PLAN.md is missing', async () => {
  const dir = makeRepo('- [ ] one\n');
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 't', writes: {} });
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity, requireTestPlan: true });
  assert.equal(res.status, 'gated');
});

test('runLoop with requireTestPlan refuses to start when spec-lint fails, without calling the agent', async () => {
  const dir = makeRepo('- [ ] one\n');
  let called = false;
  const adapter = { async run() { called = true; return { exitStatus: 0, transcript: 't', changedFiles: [] }; } };
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity, requireTestPlan: true });
  assert.equal(res.status, 'gated');
  assert.deepEqual(res.steps, []);
  assert.match(res.reason ?? '', /spec-lint/);
  assert.equal(called, false);
});

test('runLoop without requireTestPlan does not run spec-lint', async () => {
  const dir = makeRepo('- [x] one\n');
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 't', writes: {} });
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity });
  assert.notEqual(res.status, 'gated');
});

test('config rejects requireTestPlan: it is not a config field, only a runStep/runLoop option', () => {
  assert.equal(validateConfig({ ...config(), requireTestPlan: true }).ok, false);
});

test('podge reports usage errors with exit 2', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-drv-cfg-'));
  const err = /** @type {string[]} */ ([]);
  const code = await withCwd(dir, () => main(['podge'], { stdout: () => {}, stderr: (s) => { err.push(s); } }));
  assert.equal(code, 2);
  assert.match(err.join(''), /podge: cannot read config .*config\.yml/);
});
