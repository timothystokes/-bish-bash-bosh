import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkScopeGate, checkAntiStubGate, checkTypeGate } from '../src/diff-gates.js';
import { runStep } from '../src/podge-step.js';
import { createFakeAdapter } from '../src/adapter.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

const addDiff = (/** @type {string} */ file, /** @type {string[]} */ lines) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`;

test('scope gate allows paths under allowedPaths and plan.md', () => {
  assert.deepEqual(checkScopeGate(['src/a.js', 'src/x/b.js', 'plan.md'], ['src/']), { ok: true });
});

test('scope gate rejects files outside allowedPaths and traversal', () => {
  const r = checkScopeGate(['src/a.js', 'package.json', 'src/../etc/x'], ['src/']);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /package\.json/);
  assert.match(r.reason ?? '', /etc\/x/);
});

test('scope gate does not treat a sibling prefix as inside the directory', () => {
  assert.equal(checkScopeGate(['src-evil/a.js'], ['src']).ok, false);
  assert.equal(checkScopeGate(['src/a.js'], ['src']).ok, true);
});

test('anti-stub gate passes real code', () => {
  assert.equal(checkAntiStubGate(addDiff('src/a.js', ['export const f = () => 1;'])).ok, true);
});

test('anti-stub gate rejects TODO, FIXME, stub and not-implemented markers in added lines', () => {
  for (const line of ['// TODO: later', '// FIXME', 'throw new Error("not implemented");', '// stub', 'return null; // placeholder']) {
    const r = checkAntiStubGate(addDiff('src/a.js', [line]));
    assert.equal(r.ok, false, line);
    assert.match(r.reason ?? '', /src\/a\.js/);
  }
});

test('anti-stub gate rejects empty function bodies', () => {
  for (const line of ['export function f() {}', 'export const g = () => {};', 'async function h(a, b) {\n}']) {
    assert.equal(checkAntiStubGate(addDiff('src/a.js', line.split('\n'))).ok, false, line);
  }
});

test('anti-stub gate ignores removed and context lines', () => {
  const diff = 'diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1,2 +1,1 @@\n-// TODO old\n // TODO context\n+const ok = 1;\n';
  assert.equal(checkAntiStubGate(diff).ok, true);
});

test('type gate skips when the repo has no tsconfig.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-type-'));
  const r = checkTypeGate(dir);
  assert.equal(r.ok, true);
  assert.match(r.detail ?? '', /skipped/);
});

test('type gate runs the command and reports failure output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-type-'));
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  assert.equal(checkTypeGate(dir, ['node', '-e', 'process.exit(0)']).ok, true);
  const bad = checkTypeGate(dir, ['node', '-e', 'console.log("TS2322");process.exit(1)']);
  assert.equal(bad.ok, false);
  assert.match(bad.reason ?? '', /TS2322/);
});

/** @returns {string} */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-gates-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  mkdirSync(join(dir, 'specs'));
  writeFileSync(join(dir, 'specs', 'a.md'), '# Spec A\n');
  writeFileSync(join(dir, 'plan.md'), '# plan\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const config = {
  roles: { build: { adapter: 'x', model: 'y' } },
  allowedPaths: ['src/'],
};
const pass = ['node', '-e', 'process.exit(0)'];
const self = { root: '/nonexistent/hodgepodge', remotes: [] };
const fake = (/** @type {Record<string, string>} */ writes) =>
  createFakeAdapter({ exitStatus: 0, transcript: 't', writes });

/** @param {string} dir */
const record = (dir) => JSON.parse(readFileSync(join(dir, '.hodgepodge/runs/r1/iterations/001/record.json'), 'utf8'));

test('runStep fails and reverts when the agent edits outside allowedPaths (scope gate)', async () => {
  const dir = makeRepo();
  const res = await runStep({ config, repoDir: dir, runId: 'r1', adapter: fake({ 'package.json': '{}\n' }), testCommand: pass, identity: self });
  assert.equal(res.status, 'failed');
  assert.equal(git(dir, 'ls-files', 'package.json'), '');
  const gate = record(dir).gates.find((/** @type {{name: string}} */ g) => g.name === 'scope');
  assert.equal(gate.ok, false);
  assert.match(gate.detail, /package\.json/);
});

test('runStep fails and reverts when the diff contains a stub (anti-stub gate)', async () => {
  const dir = makeRepo();
  const res = await runStep({ config, repoDir: dir, runId: 'r1', adapter: fake({ 'src/a.js': '// TODO finish\nexport const a = 1;\n' }), testCommand: pass, identity: self });
  assert.equal(res.status, 'failed');
  assert.equal(git(dir, 'ls-files', 'src/a.js'), '');
  const gate = record(dir).gates.find((/** @type {{name: string}} */ g) => g.name === 'anti-stub');
  assert.equal(gate.ok, false);
});

test('runStep fails when the type gate fails, and records every gate', async () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'tsconfig');
  const res = await runStep({
    config, repoDir: dir, runId: 'r1', adapter: fake({ 'src/a.js': 'export const a = 1;\n' }),
    testCommand: pass, typeCommand: ['node', '-e', 'console.log("TS1");process.exit(1)'], identity: self,
  });
  assert.equal(res.status, 'failed');
  const names = record(dir).gates.map((/** @type {{name: string}} */ g) => g.name);
  assert.deepEqual(names, ['repo', 'scope', 'anti-stub', 'tests', 'types']);
  assert.equal(record(dir).gates.find((/** @type {{name: string}} */ g) => g.name === 'types').ok, false);
});

test('runStep passes all gates for clean in-scope work', async () => {
  const dir = makeRepo();
  const res = await runStep({ config, repoDir: dir, runId: 'r1', adapter: fake({ 'src/a.js': 'export const a = 1;\n' }), testCommand: pass, identity: self });
  assert.equal(res.status, 'ok');
  assert.ok(record(dir).gates.every((/** @type {{ok: boolean}} */ g) => g.ok));
});
