import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testResults, verifyDone, applyGaps, syncImplementation } from '../src/done.js';
import { runLoop } from '../src/driver.js';
import { createFakeAdapter } from '../src/adapter.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

const SPEC = '# Spec: a\nImplementation: implemented\nEvidence: src/a.js, tests/a.test.js\n\n## Requirements\n- R-a-1: first\n- R-a-2: second\n';
const PLAN = '# Test plan\n- R-a-1 -> tests/a.test.js\n- R-a-2 -> tests/a.test.js\n- specs/a.md -> tests/a.test.js\n';

/**
 * @param {{spec?: string, src?: string}} [o]
 * @returns {string}
 */
function makeRepo({ spec = SPEC, src = 'export const a = 1;\n' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-done-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  for (const d of ['specs', 'tests', 'src']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'specs', 'a.md'), spec);
  writeFileSync(join(dir, 'tests', 'PLAN.md'), PLAN);
  writeFileSync(join(dir, 'tests', 'a.test.js'), '');
  writeFileSync(join(dir, 'src', 'a.js'), src);
  writeFileSync(join(dir, 'plan.md'), '# plan\n- [x] build a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const suite = (/** @type {string} */ out, code = 0) => ({ command: ['node', '-e', `console.log(${JSON.stringify(out)});process.exit(${code})`] });
const GREEN = '✔ R-a-1 works (1ms)\n✔ R-a-2 works (1ms)';
const ok = ['node', '-e', 'process.exit(0)'];

test('testResults reads spec-reporter and TAP lines', () => {
  const r = testResults('✔ one (2ms)\n  ✖ two (1.5ms)\nok 1 - three\nnot ok 2 - four # TODO\n# ok 9 - skipped comment\n');
  assert.deepEqual([...r].sort(), [['four', false], ['one', true], ['three', true], ['two', false]]);
});

test('verifyDone is ok with a green suite and every requirement proven by a named passing test', () => {
  const dir = makeRepo();
  const v = verifyDone(dir, { testCommand: suite(GREEN).command, typeCommand: ok });
  assert.deepEqual(v.gaps, []);
  assert.equal(v.ok, true);
  assert.deepEqual(v.report.requirements.map((r) => [r.id, r.status, r.implementation]), [
    ['R-a-1', 'passing', 'implemented'],
    ['R-a-2', 'passing', 'implemented'],
  ]);
  assert.deepEqual(v.report.requirements[0].tests, ['R-a-1 works']);
});

test('R-a-1 is not proven by a test named R-a-10', () => {
  const dir = makeRepo();
  const v = verifyDone(dir, { testCommand: suite('✔ R-a-10 x\n✔ R-a-2 y').command, typeCommand: ok });
  assert.equal(v.ok, false);
  assert.match(v.gaps.join('\n'), /R-a-1: no passing test/);
  assert.equal(v.report.requirements[0].status, 'unproven');
});

test('a failing test naming the requirement, or a red suite, is a gap', () => {
  const dir = makeRepo();
  const v = verifyDone(dir, { testCommand: suite('✔ R-a-1 x\n✖ R-a-2 y', 1).command, typeCommand: ok });
  assert.equal(v.ok, false);
  assert.match(v.gaps.join('\n'), /suite is not green/);
  assert.match(v.gaps.join('\n'), /R-a-2: no passing test/);
  assert.equal(v.report.requirements[1].status, 'failing');
});

test('failing type check and stub markers in source are gaps', () => {
  const dir = makeRepo({ src: '// TODO later\nexport const a = 1;\n' });
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  const v = verifyDone(dir, { testCommand: suite(GREEN).command, typeCommand: ['node', '-e', 'process.exit(2)'] });
  const text = v.gaps.join('\n');
  assert.match(text, /type check failed/);
  assert.match(text, /src\/a\.js: TODO/);
  assert.equal(v.ok, false);
});

test('applyGaps replaces the verification section with unchecked items and is idempotent', () => {
  const once = applyGaps('# plan\n- [x] a\n', ['R-a-1: no passing test']);
  assert.match(once, /## Verification gaps[\s\S]*- \[ \] Verify: R-a-1: no passing test/);
  const twice = applyGaps(once, ['R-a-2: no passing test']);
  assert.doesNotMatch(twice, /R-a-1/);
  assert.match(twice, /- \[ \] Verify: R-a-2/);
  assert.equal((twice.match(/## Verification gaps/g) ?? []).length, 1);
  assert.equal(applyGaps(twice, []), '# plan\n- [x] a\n');
});

test('syncImplementation derives Implementation and Evidence from per-requirement status', () => {
  const dir = makeRepo({ spec: '# Spec: a\n\n## Requirements\n- R-a-1: first\n- R-a-2: second\n' });
  const some = verifyDone(dir, { testCommand: suite('✔ R-a-1 x').command, typeCommand: ok });
  assert.deepEqual(syncImplementation(dir, some.report.requirements), ['specs/a.md']);
  assert.match(readFileSync(join(dir, 'specs', 'a.md'), 'utf8'), /^# Spec: a\nImplementation: partial\nEvidence: tests\/a\.test\.js\n/);
  const all = verifyDone(dir, { testCommand: suite(GREEN).command, typeCommand: ok });
  assert.deepEqual(syncImplementation(dir, all.report.requirements), ['specs/a.md']);
  const text = readFileSync(join(dir, 'specs', 'a.md'), 'utf8');
  assert.equal((text.match(/Implementation:/g) ?? []).length, 1);
  assert.match(text, /Implementation: implemented\nEvidence: tests\/a\.test\.js\n/);
  assert.deepEqual(syncImplementation(dir, all.report.requirements), []);
  const none = verifyDone(dir, { testCommand: suite('✔ other').command, typeCommand: ok });
  syncImplementation(dir, none.report.requirements);
  assert.doesNotMatch(readFileSync(join(dir, 'specs', 'a.md'), 'utf8'), /Evidence:/);
});

const config = {
  targetRepo: 'git@example.com:o/target.git',
  roles: { build: { adapter: 'x', model: 'y' } },
  budgets: { maxTokens: 1000, maxCostUsd: 1, maxWallClockSeconds: 60, maxIterations: 5 },
  allowedPaths: ['src/', 'plan.md', 'tests/', 'specs/'],
};
const identity = { root: '/nonexistent/hodgepodge', remotes: [] };
const fake = (/** @type {Record<string, string>} */ writes) => createFakeAdapter({ exitStatus: 0, transcript: 'ok', usage: { tokens: 1, cost: 0 }, writes });

test('runLoop: a fully ticked plan is not done while a requirement is unproven; plan gets unchecked gap items', async () => {
  const dir = makeRepo();
  const res = await runLoop({ config, repoDir: dir, runId: 'r', adapter: fake({ 'src/b.js': 'export const b = 1;\n' }), testCommand: suite('✔ R-a-1 x').command, typeCommand: ok, identity });
  assert.equal(res.status, 'over-budget');
  assert.match(readFileSync(join(dir, 'plan.md'), 'utf8'), /- \[ \] Verify: R-a-2: no passing test/);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('runLoop: done only after verification passes, and writes done.json evidence per requirement', async () => {
  const dir = makeRepo();
  const res = await runLoop({ config, repoDir: dir, runId: 'r', adapter: fake({ 'src/b.js': 'export const b = 1;\n' }), testCommand: suite(GREEN).command, typeCommand: ok, identity });
  assert.equal(res.status, 'done');
  const path = join(dir, 'runs', 'r', 'done.json');
  assert.ok(existsSync(path));
  const report = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(report.ok, true);
  assert.match(readFileSync(join(dir, 'specs', 'a.md'), 'utf8'), /Implementation: implemented/);
  assert.deepEqual(report.requirements.map((/** @type {any} */ r) => r.id), ['R-a-1', 'R-a-2']);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('runLoop without requirement IDs in specs keeps the plan-tick done', async () => {
  const dir = makeRepo({ spec: '# Spec: a\n\n## Requirements\n- plain rule\n' });
  const res = await runLoop({ config, repoDir: dir, runId: 'r', adapter: fake({ 'src/b.js': 'export const b = 1;\n' }), testCommand: ok, typeCommand: ok, identity });
  assert.equal(res.status, 'done');
});
