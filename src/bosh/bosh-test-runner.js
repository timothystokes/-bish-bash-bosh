// Runs the project's own `.bish-bash-bosh/tests/` suite via Node's built-in test runner: the
// code-enforced gate `bosh`'s Build Loop uses before ticking a plan.md item (never trusting the
// agent's own claim that its work passed). Requires at least one `*.test.js` file to exist anywhere
// under `.bish-bash-bosh/tests/` — a directory that is missing or has no test file in it yet is treated
// as a failing gate, since every item is expected to add one (see src/bosh/prompts/bosh-build.md).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TESTS_DIR = '.bish-bash-bosh/tests';

// Recursively collects every `*.test.js` path under `dir`.
function findTestFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTestFiles(full));
    else if (entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

/** @param {string} repoDir @returns {{ ok: boolean, output: string }} */
export function runTestSuite(repoDir) {
  const dir = join(repoDir, TESTS_DIR);
  const files = findTestFiles(dir);
  if (files.length === 0) {
    return { ok: false, output: `No *.test.js file found under ${TESTS_DIR}: every plan item must add at least one.` };
  }
  // Strip NODE_TEST_CONTEXT/NODE_TEST_WORKER_ID: when bish-bash-bosh's own test suite (itself a
  // `node --test` run) exercises this function, Node would otherwise treat the spawned process as a
  // nested test worker of the *outer* run and always report a zero exit status regardless of the
  // inner suite's actual pass/fail result.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  const res = spawnSync(process.execPath, ['--test', ...files], { cwd: repoDir, encoding: 'utf8', env });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  return { ok: res.status === 0, output };
}
