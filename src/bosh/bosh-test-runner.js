// Runs the project's own `.bish-bash-bosh/tests/` suite via Node's built-in test runner: the
// code-enforced gate `bosh`'s Build Loop uses before ticking a plan.md item (never trusting the
// agent's own claim that its work passed). Requires at least one `*.test.js` file to exist anywhere
// under `.bish-bash-bosh/tests/` — a directory that is missing or has no test file in it yet is treated
// as a failing gate, since every item is expected to add one (see src/bosh/prompts/bosh-test-writer.js).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
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

// Every harness test file with a change stamp (mtime and size), so the Build Loop can tell which ones a step added or edited.
/** @param {string} repoDir @returns {Map<string, string>} */
export function listTestFiles(repoDir) {
  return new Map(findTestFiles(join(repoDir, TESTS_DIR)).map((f) => {
    const st = statSync(f);
    return [f, `${st.mtimeMs}:${st.size}`];
  }));
}

// Runs the whole suite, or only `only` (absolute paths from listTestFiles) when given.
/** @param {string} repoDir @param {string[]} [only] @returns {{ ok: boolean, output: string }} */
export function runTestSuite(repoDir, only) {
  const dir = join(repoDir, TESTS_DIR);
  const files = only?.length ? only : findTestFiles(dir);
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

// Sorts the failing tests in a run's spec-reporter output by kind. `assertions`: the test ran and an assertion failed
// (behaviour wrong or missing). `errors`: the test itself is broken (it threw something other than an assertion, the file
// crashed, or a probe it ran died with a ReferenceError/SyntaxError that surfaced as a failed exit-code assertion).
/** @param {string} output @returns {{ assertions: {name: string, error: string}[], errors: {name: string, error: string}[] }} */
export function classifyFailures(output) {
  const kinds = { assertions: [], errors: [] };
  for (const block of output.split(/^test at .*$/m).slice(1)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const name = (lines[0] ?? '').replace(/^✖\s*/, '').replace(/\s+\([\d.]+ms\)$/, '');
    const error = lines[1] ?? '';
    if (!name || /subtests? failed/.test(error)) continue;
    const probe = lines.slice(1, 14).find((l) => /\b(ReferenceError|SyntaxError)\b/.test(l));
    const broken = !error.startsWith('AssertionError [ERR_ASSERTION]') || probe;
    (broken ? kinds.errors : kinds.assertions).push({ name, error: (probe ?? error).slice(0, 200) });
  }
  return kinds;
}

// Feedback text describing which failures are errors in the tests themselves, or '' when every failure is an assertion.
/** @param {string} output */
export function describeTestErrors(output) {
  const { errors } = classifyFailures(output);
  if (errors.length === 0) return '';
  return `These tests are broken (they error instead of failing an assertion):\n${errors.map((e) => `- ${e.name}: ${e.error}`).join('\n')}\n`;
}
