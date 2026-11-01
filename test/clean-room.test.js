import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportBundle } from '../src/clean-room.js';
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

test('hodgepodge clean-room CLI exports the bundle and prints a summary', async () => {
  const src = makeSource();
  const dest = builderDir();
  let out = '';
  const code = await main(['clean-room', '--source', src, '--repo', dest], { stdout: (/** @type {string} */ s) => { out += s; } });
  assert.equal(code, 0);
  assert.match(out, /clean-room: exported \d+ files? \(commit [0-9a-f]+\)/);
  assert.equal(existsSync(join(dest, 'specs', 'greet.md')), true);
  assert.equal(await main(['clean-room', '--repo', dest], { stderr: () => {} }), 2);
});
