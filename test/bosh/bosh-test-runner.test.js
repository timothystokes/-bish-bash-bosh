import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { freshDir } from '../support/project.js';
import { runTestSuite, failingTestFiles, summarizeTestOutput } from '../../src/bosh/bosh-test-runner.js';

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

const FAILED_RUN = [
  '✔ passes (1ms)',
  '✖ stale one (1ms)',
  '✖ stale one (1ms)',
  'ℹ tests 3',
  'ℹ pass 1',
  'ℹ fail 2',
  '✖ failing tests:',
  'test at .bish-bash-bosh/tests/09-x.test.js:64:1',
  '✖ stale one (1ms)',
  "  AssertionError [ERR_ASSERTION]: expected 'FunctionDef'",
  '      at TestContext.<anonymous> (file:///x.js:1:1)',
  'test at .bish-bash-bosh/tests/10-y.test.js:5:1',
  '✖ other (1ms)',
  '  Error: boom',
].join('\n');

test('failingTestFiles lists the files that hold a failing test', () => {
  assert.deepEqual([...failingTestFiles(FAILED_RUN)], ['.bish-bash-bosh/tests/09-x.test.js', '.bish-bash-bosh/tests/10-y.test.js']);
});

test('summarizeTestOutput keeps counts and each failing test once, without passing lines', () => {
  const out = summarizeTestOutput(FAILED_RUN);
  assert.match(out, /^Tests: 3, passed: 1, failed: 2\./);
  assert.match(out, /- stale one \[\.bish-bash-bosh\/tests\/09-x\.test\.js:64:1\]: AssertionError/);
  assert.match(out, /- other \[\.bish-bash-bosh\/tests\/10-y\.test\.js:5:1\]: Error: boom/);
  assert.doesNotMatch(out, /passes|TestContext/);
  assert.equal(summarizeTestOutput('✔ a\ncrash').trim(), 'crash');
});
