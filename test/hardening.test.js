import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkHardeningGate } from '../src/podge-hardening-gate.js';
import { loadModePrompt } from '../src/prompts.js';
import { runStep } from '../src/podge-step.js';
import { validateConfig } from '../src/config.js';
import { createFakeAdapter } from '../src/adapter.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-hd-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  mkdirSync(join(dir, 'specs'));
  writeFileSync(join(dir, 'specs', 'a.md'), '# Spec: A\n');
  writeFileSync(join(dir, 'plan.md'), '- [ ] harden\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const config = (/** @type {object} */ extra = {}) => ({
  mode: 'test-hardening',
  roles: { build: { adapter: 'f', model: 'm' } },
  budgets: { maxWallClockSeconds: 60, maxIterations: 5 },
  allowedPaths: ['src/', 'tests/'],
  ...extra,
});
const identity = { root: '/nonexistent/hodgepodge', remotes: [] };
const pass = ['node', '-e', 'process.exit(0)'];
const fail = ['node', '-e', 'console.log("score 40%"); process.exit(1)'];
const testWrite = { 'tests/extra.test.js': 'export const t = 1;\n' };
const adapterWith = (/** @type {Record<string,string>} */ writes) =>
  createFakeAdapter({ exitStatus: 0, transcript: 't', writes });

test('prompt carries hardening rules', () => {
  const p = loadModePrompt('test-hardening');
  assert.match(p, /mutation/i);
  assert.match(p, /coverage/i);
  assert.match(p, /do not (change|edit|modify) .*source/i);
  assert.match(p, /plan\.md/);
});

test('config accepts hardenCommand as a string array only', () => {
  assert.equal(validateConfig(config({ hardenCommand: ['npm', 'run', 'mutate'] })).ok, true);
  assert.equal(validateConfig(config({ hardenCommand: 'npm run mutate' })).ok, false);
  assert.equal(validateConfig(config({ hardenCommand: [] })).ok, false);
});

test('gate: passes on exit 0, fails with output on non-zero, fails when the command is missing', () => {
  const dir = makeRepo();
  assert.equal(checkHardeningGate(dir, pass).ok, true);
  const bad = checkHardeningGate(dir, fail);
  assert.equal(bad.ok, false);
  assert.match(bad.reason ?? '', /score 40%/);
  const none = checkHardeningGate(dir, undefined);
  assert.equal(none.ok, false);
  assert.match(none.reason ?? '', /hardenCommand/);
});

test('runStep in test-hardening mode without a command is gated before any agent call', async () => {
  let called = false;
  const inner = adapterWith(testWrite);
  const adapter = { ...inner, run: (/** @type {any} */ r) => { called = true; return inner.run(r); } };
  const res = await runStep({ config: config(), repoDir: makeRepo(), runId: 'r', adapter, testCommand: pass, identity });
  assert.equal(res.status, 'gated');
  assert.match(res.reason ?? '', /hardenCommand/);
  assert.equal(called, false);
});

test('runStep accepts test-only changes when the hardening gate passes', async () => {
  const dir = makeRepo();
  const res = await runStep({ config: config({ hardenCommand: pass }), repoDir: dir, runId: 'r', adapter: adapterWith(testWrite), testCommand: pass, identity });
  assert.equal(res.status, 'ok', res.reason);
  assert.ok(existsSync(join(dir, 'tests', 'extra.test.js')));
});

test('runStep fails and reverts when the hardening gate fails', async () => {
  const dir = makeRepo();
  const res = await runStep({ config: config({ hardenCommand: fail }), repoDir: dir, runId: 'r', adapter: adapterWith(testWrite), testCommand: pass, identity });
  assert.equal(res.status, 'failed');
  assert.equal(existsSync(join(dir, 'tests', 'extra.test.js')), false);
});

test('runStep fails and reverts when the agent changes source outside tests/', async () => {
  const dir = makeRepo();
  const res = await runStep({
    config: config({ hardenCommand: pass }), repoDir: dir, runId: 'r',
    adapter: adapterWith({ ...testWrite, 'src/x.js': 'export const x = 1;\n' }), testCommand: pass, identity,
  });
  assert.equal(res.status, 'failed');
  assert.equal(existsSync(join(dir, 'src', 'x.js')), false);
});

test('other modes ignore hardenCommand', async () => {
  const dir = makeRepo();
  const res = await runStep({
    config: config({ mode: 'forward', hardenCommand: fail }), repoDir: dir, runId: 'r',
    adapter: adapterWith({ 'src/x.js': 'export const x = 1;\n' }), testCommand: pass, identity,
  });
  assert.equal(res.status, 'ok', res.reason);
});
