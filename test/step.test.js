import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStep, buildPrompt } from '../src/podge-step.js';
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

const config = (/** @type {string} */ _targetRepo) => ({
  adapter: 'x', model: 'y',
  allowedPaths: ['src/'],
});

const adapter = (f = {}) =>
  createFakeAdapter({
    exitStatus: 0,
    transcript: 'done',
    writes: { 'src/new.js': 'export const x = 1;\n' },
    ...f,
  });

const pass = ['node', '-e', 'process.exit(0)'];
const fail = ['node', '-e', 'console.log("boom");process.exit(1)'];
const self = { root: '/nonexistent/hodgepodge', remotes: [] };

test('buildPrompt stacks loop prompt, your plan item and spec pointers', () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'plan.md'), '# plan\n- [ ] Next: do a thing\n');
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
  assert.deepEqual(Object.keys(res).sort(), ['iteration', 'sha', 'status'], 'no cost or token fields');
  assert.equal(res.sha, git(dir, 'rev-parse', 'HEAD'));
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.ok(existsSync(join(dir, 'src', 'new.js')));
  const rec = JSON.parse(readFileSync(join(dir, '.hodgepodge/runs/r1/iterations/001/record.json'), 'utf8'));
  assert.equal(rec.status, 'ok');
  assert.deepEqual(rec.changedFiles, ['src/new.js']);
  assert.match(readFileSync(join(dir, '.hodgepodge/runs/r1/iterations/001/diff'), 'utf8'), /src\/new\.js/);
});

test('second step advances the iteration number', async () => {
  const dir = makeRepo();
  const args = { config: config('o/target'), repoDir: dir, runId: 'r1', testCommand: pass, identity: self };
  await runStep({ ...args, adapter: adapter() });
  const res = await runStep({ ...args, adapter: adapter({ writes: { 'src/two.js': '1\n' } }) });
  assert.equal(res.iteration, 2);
  assert.deepEqual(readdirSync(join(dir, '.hodgepodge/runs/r1/iterations')).sort(), ['001', '002']);
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
  const rec = JSON.parse(readFileSync(join(dir, '.hodgepodge/runs/r1/iterations/001/record.json'), 'utf8'));
  assert.equal(rec.status, 'failed');
  assert.match(readFileSync(join(dir, '.hodgepodge/runs/r1/iterations/001/diff'), 'utf8'), /src\/new\.js/);
  assert.match(readFileSync(join(dir, '.hodgepodge/runs/r1/iterations/001/test.json'), 'utf8'), /boom/);
});

test('failing step with runs/ git-ignored (nothing to commit) still returns failed and records a commit', async () => {
  const dir = makeRepo();
  writeFileSync(join(dir, '.gitignore'), 'runs/\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'ignore runs');
  const res = await runStep({
    config: config('o/target'), repoDir: dir, runId: 'r1',
    adapter: adapter(), testCommand: fail, identity: self,
  });
  assert.equal(res.status, 'failed');
  assert.match(git(dir, 'log', '-1', '--format=%s'), /podge step r1\/001: failed/);
  assert.equal(git(dir, 'status', '--porcelain'), '');
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

test('repo gate refuses when repoDir is the hodgepodge checkout before touching anything', async () => {
  const dir = makeRepo();
  const res = await runStep({
    config: config('o/target'), repoDir: dir, runId: 'r1',
    adapter: adapter(), testCommand: pass,
    identity: { root: dir, remotes: [] },
  });
  assert.equal(res.status, 'gated');
  assert.equal(res.sha, null);
  assert.ok(!existsSync(join(dir, '.hodgepodge', 'runs')));
  assert.ok(!existsSync(join(dir, 'src')));
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

test('step calls the adapter with no limits cap, and records wall-clock seconds', async () => {
  const dir = makeRepo();
  const cfg = config('git@example.com:o/target.git');
  await runStep({ config: cfg, repoDir: dir, runId: 'rc', adapter: adapter(), testCommand: pass, identity: self });
  /** @type {any} */
  let seen;
  await runStep({
    config: cfg, repoDir: dir, runId: 'rc', testCommand: pass, identity: self,
    adapter: { run: async (req) => { seen = req.limits; return { exitStatus: 0, transcript: '', changedFiles: [] }; } },
  });
  assert.deepEqual(seen, {});
  const u = JSON.parse(readFileSync(join(dir, '.hodgepodge/runs/rc/iterations/001/usage.json'), 'utf8'));
  assert.equal(typeof u.seconds, 'number');
});

const formatSpec = '# Spec: Order\nImplementation: none\n\n## Requirements\n- R-order-1: Output must conform to `specs/schemas/order.json`.\n\n## Formats\n- json-schema: specs/schemas/order.json -> src/order.json\n\n## Out of scope\n- x\n';
const orderSchema = JSON.stringify({ $id: 'https://x/order', type: 'object', required: ['total'] });

/** @param {string} dir */
function addFormatSpec(dir) {
  mkdirSync(join(dir, 'specs', 'schemas'), { recursive: true });
  writeFileSync(join(dir, 'specs', 'order.md'), formatSpec);
  writeFileSync(join(dir, 'specs', 'schemas', 'order.json'), orderSchema);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'formats');
}

test('format gate: output violating the declared schema fails the step and is reverted', async () => {
  const dir = makeRepo();
  addFormatSpec(dir);
  const res = await runStep({
    config: config('o/target'), repoDir: dir, runId: 'r1',
    adapter: adapter({ writes: { 'src/order.json': '{}' } }), testCommand: pass, identity: self,
  });
  assert.equal(res.status, 'failed');
  assert.ok(!existsSync(join(dir, 'src', 'order.json')));
  const rec = JSON.parse(readFileSync(join(dir, '.hodgepodge/runs/r1/iterations/001/record.json'), 'utf8'));
  const g = rec.gates.find((/** @type {{name: string}} */ x) => x.name === 'formats');
  assert.equal(g.ok, false);
  assert.match(g.detail, /src\/order\.json/);
});

test('format gate: conforming output passes and records the gate', async () => {
  const dir = makeRepo();
  addFormatSpec(dir);
  const res = await runStep({
    config: config('o/target'), repoDir: dir, runId: 'r1',
    adapter: adapter({ writes: { 'src/order.json': '{"total": 1}' } }), testCommand: pass, identity: self,
  });
  assert.equal(res.status, 'ok');
  const rec = JSON.parse(readFileSync(join(dir, '.hodgepodge/runs/r1/iterations/001/record.json'), 'utf8'));
  assert.ok(rec.gates.some((/** @type {{name: string, ok: boolean}} */ x) => x.name === 'formats' && x.ok));
});

test('format gate: absent when no spec declares formats', async () => {
  const dir = makeRepo();
  await runStep({ config: config('o/target'), repoDir: dir, runId: 'r1', adapter: adapter(), testCommand: pass, identity: self });
  const rec = JSON.parse(readFileSync(join(dir, '.hodgepodge/runs/r1/iterations/001/record.json'), 'utf8'));
  assert.ok(!rec.gates.some((/** @type {{name: string}} */ x) => x.name === 'formats'));
});

// Prints the spec-reporter failure line for "red one" until src/new.js exists, and always for "red two".
const redSuite = ['node', '-e', `
const fs = require('node:fs');
const bad = [];
if (!fs.existsSync('src/new.js')) bad.push('red one');
if (fs.existsSync('src/worse.js')) bad.push('fresh red');
bad.push('red two');
for (const n of bad) console.log('✖ ' + n + ' (1.2ms)');
process.exit(1);
`];

test('tests gate: a planning-only step skips the tests gate even when the suite is red', async () => {
  const dir = makeRepo();
  const res = await runStep({
    config: config('o/target'), repoDir: dir, runId: 'r1',
    adapter: adapter({ writes: { 'plan.md': '# plan\n- [ ] one\n' } }), testCommand: fail, identity: self,
  });
  assert.equal(res.status, 'ok');
  const rec = JSON.parse(readFileSync(join(dir, '.hodgepodge/runs/r1/iterations/001/record.json'), 'utf8'));
  const g = rec.gates.find((/** @type {{name: string}} */ x) => x.name === 'tests');
  assert.equal(g.ok, true);
  assert.match(g.detail, /planning-only/);
});

test('tests gate: a step that touches code passes while only previously failing tests still fail', async () => {
  const dir = makeRepo();
  const res = await runStep({
    config: config('o/target'), repoDir: dir, runId: 'r1',
    adapter: adapter({ writes: { 'src/other.js': 'export const y = 2;\n' } }), testCommand: redSuite, identity: self,
  });
  assert.equal(res.status, 'ok');
  const rec = JSON.parse(readFileSync(join(dir, '.hodgepodge/runs/r1/iterations/001/record.json'), 'utf8'));
  const g = rec.gates.find((/** @type {{name: string}} */ x) => x.name === 'tests');
  assert.equal(g.ok, true);
  assert.match(g.detail, /no regression/);
});

test('tests gate: a newly failing test fails the step and the work is reverted', async () => {
  const dir = makeRepo();
  const res = await runStep({
    config: config('o/target'), repoDir: dir, runId: 'r1',
    adapter: adapter({ writes: { 'src/worse.js': 'export const z = 3;\n' } }), testCommand: redSuite, identity: self,
  });
  assert.equal(res.status, 'failed');
  assert.ok(!existsSync(join(dir, 'src', 'worse.js')));
});

test('tests gate: a failing suite whose failures cannot be named still fails the step', async () => {
  const dir = makeRepo();
  const res = await runStep({
    config: config('o/target'), repoDir: dir, runId: 'r1',
    adapter: adapter(), testCommand: fail, identity: self,
  });
  assert.equal(res.status, 'failed');
});
