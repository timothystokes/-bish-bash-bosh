import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTestPlanGate } from '../src/test-plan-gate.js';
import { runStep } from '../src/step.js';
import { createFakeAdapter } from '../src/adapter.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

const RED = ['node', '-e', 'process.exit(1)'];
const GREEN = ['node', '-e', 'process.exit(0)'];

/** @param {Record<string, string>} files */
function target(files) {
  const dir = mkdtempSync(join(tmpdir(), 'tp-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), c);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const GOOD = {
  'specs/a.md': '# A\n',
  'tests/a.test.js': '// t\n',
  'tests/PLAN.md': '# Test plan\n| spec | test |\n|---|---|\n| specs/a.md | tests/a.test.js |\n',
};

test('fails when tests/PLAN.md is missing', () => {
  const d = target({ 'specs/a.md': '# A\n' });
  const r = checkTestPlanGate(d, { testCommand: RED, requireRed: true });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /PLAN\.md/);
});

test('fails when a spec has no mapped test', () => {
  const d = target({ ...GOOD, 'specs/b.md': '# B\n' });
  const r = checkTestPlanGate(d, { testCommand: RED, requireRed: true });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /specs\/b\.md/);
});

test('fails when a mapped test file does not exist', () => {
  const d = target({ ...GOOD, 'tests/PLAN.md': '| specs/a.md | tests/nope.test.js |\n' });
  const r = checkTestPlanGate(d, { testCommand: RED, requireRed: true });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /nope\.test\.js/);
});

test('fails when tests are green before the build starts (not red first)', () => {
  const d = target(GOOD);
  const r = checkTestPlanGate(d, { testCommand: GREEN, requireRed: true });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /red|fail/i);
});

test('passes with plan, existing tests and a red suite', () => {
  const d = target(GOOD);
  assert.equal(checkTestPlanGate(d, { testCommand: RED, requireRed: true }).ok, true);
});

test('red check is skipped once build iterations exist (green allowed)', () => {
  const d = target(GOOD);
  assert.equal(checkTestPlanGate(d, { testCommand: GREEN, requireRed: false }).ok, true);
});

const config = (/** @type {string} */ dir) => ({
  targetRepo: dir,
  roles: { build: { adapter: 'fake', model: 'm' } },
  budgets: { maxTokens: 1e6, maxCostUsd: 100, maxWallClockSeconds: 600, maxIterations: 10 },
  allowedPaths: ['src/'],
});
const identity = { remotes: [], root: '/nonexistent-harness' };

test('runStep with requireTestPlan gates, without calling the adapter or writing records', async () => {
  const d = target({ 'specs/a.md': '# A\n' });
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: '', usage: { tokens: 0, cost: 0 }, writes: { 'src/x.js': 'export const x = 1;\n' } });
  const r = await runStep({ config: config(d), repoDir: d, runId: 'r1', adapter, testCommand: RED, requireTestPlan: true, identity });
  assert.equal(r.status, 'gated');
  assert.match(r.reason ?? '', /PLAN\.md/);
  assert.equal(existsSync(join(d, 'src')), false);
  assert.equal(existsSync(join(d, 'runs')), false);
  assert.equal(git(d, 'status', '--porcelain'), '');
});
