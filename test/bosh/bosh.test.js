import { MAX_ATTEMPTS } from '../../src/bosh/bosh-build-loop.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../src/cli/cli.js';
import { freshDir, initGitRepo, commitProjectConfig, withCwd } from '../support/project.js';

const config = (overrides = {}) => ({ adapter: 'f', model: 'm', ...overrides });

function fakeAdapter() {
  const calls = [];
  return {
    calls,
    run: async (req) => {
      calls.push(req);
      return { exitStatus: 0, transcript: '', changedFiles: [] };
    },
  };
}

// Writes a harness test that is red until `done.flag` exists in the project, as the test-writing step would.
function seedRedTest(dir) {
  mkdirSync(join(dir, '.bish-bash-bosh', 'tests'), { recursive: true });
  writeFileSync(
    join(dir, '.bish-bash-bosh', 'tests', 'a.test.js'),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { existsSync } from 'node:fs';\ntest('done', () => assert.ok(existsSync('done.flag')));\n",
  );
}

test('bosh requires plan.md (written by `bash`) to exist first', async () => {
  const dir = initGitRepo(freshDir('bosh-cli-'));
  commitProjectConfig(dir, config());
  const err = [];
  const code = await withCwd(dir, () => main(['bosh'], { stdout: () => {}, stderr: (s) => err.push(s) }));
  assert.equal(code, 2);
  assert.match(err.join(''), /\.bish-bash-bosh\/plan\.md not found\. Run `bash` first\./);
});

test('bosh seeds .bish-bash-bosh/test-harness.js from its template and creates .bish-bash-bosh/tests/ on its first run', async () => {
  const dir = initGitRepo(freshDir('bosh-cli-'));
  commitProjectConfig(dir, config({ adapter: 'bl' }));
  writeFileSync(join(dir, '.bish-bash-bosh', 'plan.md'), '# Plan\n\n');
  const code = await withCwd(dir, () =>
    main(['bosh'], { registry: { bl: fakeAdapter }, stdout: () => {}, stderr: () => {} }));
  assert.equal(code, 0, 'nothing to process, but seeding still happens');
  assert.ok(existsSync(join(dir, '.bish-bash-bosh', 'test-harness.js')), 'test-harness.js is seeded');
  assert.ok(existsSync(join(dir, '.bish-bash-bosh', 'tests')), '.bish-bash-bosh/tests/ is created');
});

test('bosh drives the Build Loop over every unprocessed plan.md item: fresh-context test-writing, implementing and verifying calls, ticking only once its own red then green gates pass', async () => {
  const dir = initGitRepo(freshDir('bosh-cli-'));
  commitProjectConfig(dir, config({ adapter: 'bl' }));
  writeFileSync(
    join(dir, '.bish-bash-bosh', 'plan.md'),
    '# Plan\n\n1. [ ] Phase: Core. Task: Implement the login screen. Depends: None\n',
  );
  const adapter = {
    calls: [],
    run: async (req) => {
      adapter.calls.push(req);
      // Call 1 writes the (red) test, call 2 implements the item so the test goes green.
      if (adapter.calls.length === 1) seedRedTest(dir);
      if (adapter.calls.length === 2) writeFileSync(join(dir, 'done.flag'), '');
      return { exitStatus: 0, transcript: '', changedFiles: [] };
    },
  };
  const registry = { bl: () => adapter };
  const out = [];
  const code = await withCwd(dir, () =>
    main(['bosh'], { registry, stdout: (s) => out.push(s), stderr: () => {} }));
  assert.equal(code, 0);
  assert.equal(adapter.calls.length, 3, 'one test-writing, one implementing and one QA call for the single item');
  assert.match(out.join(''), /Build complete: 1 item processed this run\./);
  assert.ok(existsSync(join(dir, '.bish-bash-bosh', 'bosh-log.md')), 'bosh-log.md is created');
  const planAfter = readFileSync(join(dir, '.bish-bash-bosh', 'plan.md'), 'utf8');
  assert.match(planAfter, /1\. \[x\] Phase: Core\. Task: Implement the login screen\. Depends: None/, 'the item is marked processed');
  for (const call of adapter.calls) assert.ok(!Object.hasOwn(call, 'session'), 'bosh never opts into session tracking');
});

test('bosh stops and leaves the item unticked when its own test gate fails, reporting why', async () => {
  const dir = initGitRepo(freshDir('bosh-cli-'));
  commitProjectConfig(dir, config({ adapter: 'bl' }));
  writeFileSync(
    join(dir, '.bish-bash-bosh', 'plan.md'),
    '# Plan\n\n1. [ ] Phase: Core. Task: Implement the login screen. Depends: None\n',
  );
  const adapter = fakeAdapter();
  const out = [];
  const code = await withCwd(dir, () =>
    main(['bosh'], { registry: { bl: () => adapter }, stdout: (s) => out.push(s), stderr: () => {} }));
  assert.equal(code, 1, 'the agent never added a test, so the red gate fails');
  assert.equal(adapter.calls.length, MAX_ATTEMPTS, 'only the test-writing step runs, retried up to the cap');
  assert.match(out.join(''), /Build stopped after 0 items/);
  const planAfter = readFileSync(join(dir, '.bish-bash-bosh', 'plan.md'), 'utf8');
  assert.match(planAfter, /1\. \[ \] Phase: Core\./, 'left unticked so a later `bosh` run retries it');
});
