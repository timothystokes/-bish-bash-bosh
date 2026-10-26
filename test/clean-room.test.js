import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportBundle, checkCleanRoomGate } from '../src/clean-room.js';
import { loadModePrompt } from '../src/prompts.js';
import { runStep } from '../src/step.js';
import { createFakeAdapter } from '../src/adapter.js';
import { main } from '../src/cli.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();

function makeSource() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-cr-src-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  for (const d of ['specs', 'tests', 'src', 'runs/r1']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'specs', 'greet.md'), '# Spec: Greeter\n');
  writeFileSync(join(dir, 'tests', 'greet.test.js'), 'ok\n');
  writeFileSync(join(dir, 'tests', 'PLAN.md'), '| specs/greet.md | tests/greet.test.js |\n');
  writeFileSync(join(dir, 'src', 'secret.js'), 'export const SECRET_IMPL = 1;\n');
  writeFileSync(join(dir, 'runs', 'r1', 'transcript.txt'), 'SECRET_IMPL\n');
  writeFileSync(join(dir, 'plan.md'), 'source plan\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const builderDir = () => join(mkdtempSync(join(tmpdir(), 'hodge-cr-b-')), 'builder');

test('exportBundle copies specs/ and tests/ only, in a fresh builder repo', () => {
  const src = makeSource();
  const dest = builderDir();
  const res = exportBundle({ sourceDir: src, builderDir: dest });
  assert.equal(res.ok, true);
  assert.deepEqual(git(dest, 'ls-files').split('\n').sort(), ['specs/greet.md', 'tests/PLAN.md', 'tests/greet.test.js']);
  assert.equal(existsSync(join(dest, 'src')), false);
  assert.equal(existsSync(join(dest, 'runs')), false);
  assert.equal(existsSync(join(dest, 'plan.md')), false);
  assert.equal(readFileSync(join(dest, 'specs', 'greet.md'), 'utf8'), '# Spec: Greeter\n');
});

test('exportBundle refuses a non-empty builder dir and same source/builder', () => {
  const src = makeSource();
  assert.equal(exportBundle({ sourceDir: src, builderDir: src }).ok, false);
  const dest = builderDir();
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'x.txt'), 'x');
  const res = exportBundle({ sourceDir: src, builderDir: dest });
  assert.equal(res.ok, false);
  assert.match(res.reason ?? '', /not empty/i);
});

test('exportBundle refuses a source without specs or tests', () => {
  const src = makeSource();
  git(src, 'rm', '-rq', 'tests');
  const res = exportBundle({ sourceDir: src, builderDir: builderDir() });
  assert.equal(res.ok, false);
  assert.match(res.reason ?? '', /tests/);
});

test('firewall gate passes on an exported builder repo', () => {
  const dest = builderDir();
  exportBundle({ sourceDir: makeSource(), builderDir: dest });
  assert.equal(checkCleanRoomGate(dest).ok, true);
});

test('firewall gate fails when the root commit holds anything but specs/tests', () => {
  const dest = builderDir();
  exportBundle({ sourceDir: makeSource(), builderDir: dest });
  git(dest, 'config', 'user.email', 't@example.com');
  git(dest, 'config', 'user.name', 'T');
  mkdirSync(join(dest, 'src'));
  writeFileSync(join(dest, 'src', 'secret.js'), 'x\n');
  git(dest, 'add', '-A');
  git(dest, 'commit', '--amend', '-qm', 'leak');
  const g = checkCleanRoomGate(dest);
  assert.equal(g.ok, false);
  assert.match(g.reason ?? '', /src\/secret\.js/);
});

test('firewall gate fails without specs or tests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-cr-e-'));
  git(dir, 'init', '-q', '-b', 'main');
  assert.equal(checkCleanRoomGate(dir).ok, false);
});

test('firewall gate rejects a builder repo that has the source repo as a remote', () => {
  const dest = builderDir();
  exportBundle({ sourceDir: makeSource(), builderDir: dest });
  git(dest, 'remote', 'add', 'origin', 'git@example.com:o/source.git');
  const g = checkCleanRoomGate(dest, { sourceRemotes: ['git@example.com:o/source.git'] });
  assert.equal(g.ok, false);
  assert.match(g.reason ?? '', /remote/);
});

test('clean-room prompt tells the builder it only has specs and tests', () => {
  const p = loadModePrompt('clean-room');
  assert.match(p, /specs\//);
  assert.match(p, /never|do not/i);
  assert.match(p, /source/i);
});

const config = () => ({
  mode: 'clean-room',
  targetRepo: 'git@example.com:o/target.git',
  roles: { build: { adapter: 'f', model: 'm' } },
  budgets: { maxTokens: 1000, maxCostUsd: 1, maxWallClockSeconds: 60, maxIterations: 5 },
  allowedPaths: ['src/'],
});
const identity = { root: '/nonexistent/hodgepodge', remotes: [] };

test('runStep in clean-room mode is gated, with no agent call, on a leaky builder repo', async () => {
  const dest = builderDir();
  exportBundle({ sourceDir: makeSource(), builderDir: dest });
  git(dest, 'config', 'user.email', 't@example.com');
  git(dest, 'config', 'user.name', 'T');
  mkdirSync(join(dest, 'src'));
  writeFileSync(join(dest, 'src', 'secret.js'), 'x\n');
  git(dest, 'add', '-A');
  git(dest, 'commit', '--amend', '-qm', 'leak');
  let calls = 0;
  const adapter = { async run() { calls++; return createFakeAdapter({ exitStatus: 0, transcript: '', usage: { tokens: 0, cost: 0 }, writes: {} }).run(/** @type {any} */ ({})); } };
  const res = await runStep({ config: config(), repoDir: dest, runId: 'r', adapter, testCommand: ['node', '-e', 'process.exit(0)'], identity });
  assert.equal(res.status, 'gated');
  assert.match(res.reason ?? '', /clean-room/);
  assert.equal(calls, 0);
});

test('hodgepodge clean-room CLI exports the bundle and prints JSON', async () => {
  const src = makeSource();
  const dest = builderDir();
  let out = '';
  const code = await main(['clean-room', '--source', src, '--repo', dest], { stdout: (/** @type {string} */ s) => { out += s; } });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).ok, true);
  assert.equal(existsSync(join(dest, 'specs', 'greet.md')), true);
  assert.equal(await main(['clean-room', '--repo', dest], { stderr: () => {} }), 2);
});
