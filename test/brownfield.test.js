import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBrownfieldGate } from '../src/podge-brownfield-gate.js';
import { loadModePrompt } from '../src/prompts.js';
import { runStep } from '../src/podge-step.js';
import { runLoop } from '../src/podge-driver.js';
import { createFakeAdapter } from '../src/adapter.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();

/** @param {boolean} withSpecs */
function makeRepo(withSpecs) {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-bf-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  mkdirSync(join(dir, 'specs'));
  writeFileSync(join(dir, 'specs', withSpecs ? 'a.md' : 'README.txt'), '# Spec: A\n');
  writeFileSync(join(dir, 'plan.md'), '- [ ] change\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const config = () => ({
  mode: 'brownfield',
  adapter: 'f', model: 'm',
  allowedPaths: ['src/'],
});
const identity = { root: '/nonexistent/hodgepodge', remotes: [] };
const pass = ['node', '-e', 'process.exit(0)'];

test('brownfield prompt carries spec-delta rules', () => {
  const p = loadModePrompt('brownfield');
  assert.match(p, /spec delta/i);
  assert.match(p, /tests come first/i);
  assert.match(p, /plan\.md/);
});

test('gate: fails without specs and points at hodge --reverse', () => {
  const g = checkBrownfieldGate(makeRepo(false));
  assert.equal(g.ok, false);
  assert.match(g.reason ?? '', /hodge --reverse/);
});

test('gate: fails when specs dir is missing', () => {
  const g = checkBrownfieldGate(mkdtempSync(join(tmpdir(), 'hodge-bf-')));
  assert.equal(g.ok, false);
});

test('gate: passes when a spec exists', () => {
  assert.equal(checkBrownfieldGate(makeRepo(true)).ok, true);
});

test('runStep in brownfield mode without specs is gated before any agent call', async () => {
  const dir = makeRepo(false);
  let called = false;
  const inner = createFakeAdapter({ exitStatus: 0, transcript: 't', writes: { 'src/x.js': 'export const x = 1;\n' } });
  const adapter = { ...inner, run: (/** @type {any} */ r) => { called = true; return inner.run(r); } };
  const res = await runStep({ config: config(), repoDir: dir, runId: 'r', adapter, testCommand: pass, identity });
  assert.equal(res.status, 'gated');
  assert.match(res.reason ?? '', /hodge --reverse/);
  assert.equal(called, false);
});

test('runLoop in brownfield mode without specs is gated; with specs it runs', async () => {
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 't', writes: { 'src/x.js': 'export const x = 1;\n' } });
  const bad = await runLoop({ config: config(), repoDir: makeRepo(false), runId: 'r', adapter, testCommand: pass, identity });
  assert.equal(bad.status, 'gated');
  assert.match(bad.reason ?? '', /hodge --reverse/);
  const good = await runStep({ config: config(), repoDir: makeRepo(true), runId: 'r', adapter, testCommand: pass, identity });
  assert.equal(good.status, 'ok', good.reason);
});
