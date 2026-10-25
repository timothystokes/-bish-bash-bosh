import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStep, buildPrompt } from '../src/step.js';
import { createFakeAdapter } from '../src/adapter.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

/** @returns {string} */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-step-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  mkdirSync(join(dir, 'specs'));
  writeFileSync(join(dir, 'specs', 'a.md'), '# Spec A\n- rule\n');
  writeFileSync(join(dir, 'plan.md'), '# plan\nNext: do a thing\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const config = (/** @type {string} */ targetRepo) => ({
  targetRepo,
  roles: { build: { adapter: 'x', model: 'y' } },
  budgets: { maxTokens: 1000, maxCostUsd: 1, maxWallClockSeconds: 60, maxIterations: 5 },
  allowedPaths: ['src/'],
});

const adapter = (/** @type {Partial<import('../src/adapter.js').FakeFixture>} */ f = {}) =>
  createFakeAdapter({
    exitStatus: 0,
    transcript: 'done',
    usage: { tokens: 10, cost: 0.25 },
    writes: { 'src/new.js': 'export const x = 1;\n' },
    ...f,
  });

const pass = ['node', '-e', 'process.exit(0)'];
const fail = ['node', '-e', 'console.log("boom");process.exit(1)'];
const self = { root: '/nonexistent/hodgepodge', remotes: [] };

test('buildPrompt stacks loop prompt, specs index and plan.md', () => {
  const dir = makeRepo();
  const p = buildPrompt(dir);
  assert.match(p, /search before assuming/i);
  assert.match(p, /specs\/a\.md/);
  assert.match(p, /Spec A/);
  assert.match(p, /Next: do a thing/);
});

test('successful step commits work and the run record, emits status', async () => {
  const dir = makeRepo();
  const res = await runStep({
    config: config('git@example.com:o/target.git'), repoDir: dir, runId: 'r1',
    adapter: adapter(), testCommand: pass, identity: self,
  });
  assert.equal(res.status, 'ok');
  assert.equal(res.iteration, 1);
  assert.equal(res.cost, 0.25);
  assert.equal(res.sha, git(dir, 'rev-parse', 'HEAD'));
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.ok(existsSync(join(dir, 'src', 'new.js')));
  const rec = JSON.parse(readFileSync(join(dir, 'runs/r1/iterations/001/record.json'), 'utf8'));
  assert.equal(rec.status, 'ok');
  assert.deepEqual(rec.changedFiles, ['src/new.js']);
  assert.match(readFileSync(join(dir, 'runs/r1/iterations/001/diff'), 'utf8'), /src\/new\.js/);
});

test('second step advances the iteration number', async () => {
  const dir = makeRepo();
  const args = { config: config('o/target'), repoDir: dir, runId: 'r1', testCommand: pass, identity: self };
  await runStep({ ...args, adapter: adapter() });
  const res = await runStep({ ...args, adapter: adapter({ writes: { 'src/two.js': '1\n' } }) });
  assert.equal(res.iteration, 2);
  assert.deepEqual(readdirSync(join(dir, 'runs/r1/iterations')).sort(), ['001', '002']);
});

test('failing tests: work reverted, only the record is committed', async () => {
  const dir = makeRepo();
  const res = await runStep({
    config: config('o/target'), repoDir: dir, runId: 'r1',
    adapter: adapter(), testCommand: fail, identity: self,
  });
  assert.equal(res.status, 'failed');
  assert.ok(!existsSync(join(dir, 'src', 'new.js')));
  assert.equal(git(dir, 'status', '--porcelain'), '');
  const rec = JSON.parse(readFileSync(join(dir, 'runs/r1/iterations/001/record.json'), 'utf8'));
  assert.equal(rec.status, 'failed');
  assert.match(readFileSync(join(dir, 'runs/r1/iterations/001/diff'), 'utf8'), /src\/new\.js/);
  assert.match(readFileSync(join(dir, 'runs/r1/iterations/001/test.json'), 'utf8'), /boom/);
});

test('adapter failure gives failed status and does not run tests', async () => {
  const dir = makeRepo();
  const res = await runStep({
    config: config('o/target'), repoDir: dir, runId: 'r1',
    adapter: adapter({ exitStatus: 3 }), testCommand: fail, identity: self,
  });
  assert.equal(res.status, 'failed');
  assert.ok(!existsSync(join(dir, 'src', 'new.js')));
});

test('over-limit adapter usage is reported as over-budget', async () => {
  const dir = makeRepo();
  const res = await runStep({
    config: config('o/target'), repoDir: dir, runId: 'r1',
    adapter: adapter({ usage: { tokens: 5000, cost: 0.1 } }), testCommand: pass, identity: self,
  });
  assert.equal(res.status, 'over-budget');
});

test('repo gate refuses hodgepodge as target before touching anything', async () => {
  const dir = makeRepo();
  const res = await runStep({
    config: config('git@github.com:ticked-com/ticked-hodgepodge.git'), repoDir: dir, runId: 'r1',
    adapter: adapter(), testCommand: pass,
    identity: { root: '/x/hodgepodge', remotes: ['https://github.com/ticked-com/ticked-hodgepodge'] },
  });
  assert.equal(res.status, 'gated');
  assert.equal(res.sha, null);
  assert.ok(!existsSync(join(dir, 'runs')));
  assert.ok(!existsSync(join(dir, 'src')));
});

test('repo gate also refuses when repoDir is the hodgepodge checkout', async () => {
  const dir = makeRepo();
  const res = await runStep({
    config: config('o/target'), repoDir: dir, runId: 'r1',
    adapter: adapter(), testCommand: pass, identity: { root: dir, remotes: [] },
  });
  assert.equal(res.status, 'gated');
});

test('dirty working tree is gated (idempotence: step starts from a clean tree)', async () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'stray.txt'), 'x');
  const res = await runStep({
    config: config('o/target'), repoDir: dir, runId: 'r1',
    adapter: adapter(), testCommand: pass, identity: self,
  });
  assert.equal(res.status, 'gated');
  assert.ok(!existsSync(join(dir, 'src')));
});

test('invalid config is rejected', async () => {
  const dir = makeRepo();
  await assert.rejects(
    runStep({
      config: /** @type {any} */ ({}), repoDir: dir, runId: 'r1',
      adapter: adapter(), testCommand: pass, identity: self,
    }),
    /invalid config/,
  );
});
