import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { freshDir } from './support/project.js';
import { runTestSuite } from '../src/podge-test-runner.js';

test('runTestSuite: fails when .hodgepodge/tests does not exist (every item must add a test)', () => {
  const dir = freshDir('podge-tests-');
  const res = runTestSuite(dir);
  assert.equal(res.ok, false);
  assert.match(res.output, /\.hodgepodge\/tests/);
});

test('runTestSuite: fails when .hodgepodge/tests exists but has no *.test.js file in it', () => {
  const dir = freshDir('podge-tests-');
  mkdirSync(join(dir, '.hodgepodge', 'tests'), { recursive: true });
  const res = runTestSuite(dir);
  assert.equal(res.ok, false);
  assert.match(res.output, /\.hodgepodge\/tests/);
});

test('runTestSuite: runs node --test over .hodgepodge/tests and reports pass', () => {
  const dir = freshDir('podge-tests-');
  mkdirSync(join(dir, '.hodgepodge', 'tests'), { recursive: true });
  writeFileSync(
    join(dir, '.hodgepodge', 'tests', 'a.test.js'),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('ok', () => assert.ok(true));\n",
  );
  const res = runTestSuite(dir);
  assert.equal(res.ok, true);
});

test('runTestSuite: reports failure and the failing output when a test fails', () => {
  const dir = freshDir('podge-tests-');
  mkdirSync(join(dir, '.hodgepodge', 'tests'), { recursive: true });
  writeFileSync(
    join(dir, '.hodgepodge', 'tests', 'a.test.js'),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('nope', () => assert.ok(false));\n",
  );
  const res = runTestSuite(dir);
  assert.equal(res.ok, false);
  assert.match(res.output, /nope/);
  rmSync(dir, { recursive: true, force: true });
});
