import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { freshDir } from '../support/project.js';
import { runTestSuite } from '../../src/bosh/bosh-test-runner.js';

test('runTestSuite: fails when .bish-bash-bosh/tests does not exist (every item must add a test)', () => {
  const dir = freshDir('bosh-tests-');
  const res = runTestSuite(dir);
  assert.equal(res.ok, false);
  assert.match(res.output, /\.bish-bash-bosh\/tests/);
});

test('runTestSuite: fails when .bish-bash-bosh/tests exists but has no *.test.js file in it', () => {
  const dir = freshDir('bosh-tests-');
  mkdirSync(join(dir, '.bish-bash-bosh', 'tests'), { recursive: true });
  const res = runTestSuite(dir);
  assert.equal(res.ok, false);
  assert.match(res.output, /\.bish-bash-bosh\/tests/);
});

test('runTestSuite: runs node --test over .bish-bash-bosh/tests and reports pass', () => {
  const dir = freshDir('bosh-tests-');
  mkdirSync(join(dir, '.bish-bash-bosh', 'tests'), { recursive: true });
  writeFileSync(
    join(dir, '.bish-bash-bosh', 'tests', 'a.test.js'),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('ok', () => assert.ok(true));\n",
  );
  const res = runTestSuite(dir);
  assert.equal(res.ok, true);
});

test('runTestSuite: reports failure and the failing output when a test fails', () => {
  const dir = freshDir('bosh-tests-');
  mkdirSync(join(dir, '.bish-bash-bosh', 'tests'), { recursive: true });
  writeFileSync(
    join(dir, '.bish-bash-bosh', 'tests', 'a.test.js'),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('nope', () => assert.ok(false));\n",
  );
  const res = runTestSuite(dir);
  assert.equal(res.ok, false);
  assert.match(res.output, /nope/);
  rmSync(dir, { recursive: true, force: true });
});
