// The Build Loop: a deterministic walk through `.bish-bash-bosh/plan.md`'s prioritised checklist
// (see src/bash/prompts/bash-planner.js for the format the Plan Pass's agent writes into it: one numbered line per
// item in priority order, `<n>. [ ] T: <name> - <detail> S: <specification ids>`), with a single checkbox ticked only once that item has been
// implemented, independently verified and both gates have passed. Unlike the Interview Loop there is
// no human input: each unprocessed item is simply handed to the agent in turn. Every call — build or
// QA — starts a fresh agent context (no continuing session, unlike `bish`/`bash`): the agent is
// instructed to read `.bish-bash-bosh/plan.md` and the project's own source/test files rather than rely
// on memory of earlier calls.
import { describeTestErrors } from './bosh-test-runner.js';
import testWriterPrompt from './prompts/bosh-test-writer.js';
import builderPrompt from './prompts/bosh-builder.js';
import { join } from 'node:path';
import testFileTemplate from './templates/bosh-test-file.js';
import inspectorPrompt from './prompts/bosh-inspector.js';
import { subject } from '../shared/git-commit.js';
import { updateSpecStatus } from './bosh-spec-status.js';

const CYAN = '\x1b[1;36m';
const GREY = '\x1b[90m';
const RESET = '\x1b[0m';

// Every step (write tests, implement, verify) that fails its gate or throws is retried, in a fresh agent
// context with that failure as input, up to this many attempts.
export const MAX_ATTEMPTS = 5;
const MAX_TEST_ROUNDS = 3;
const MAX_FAILURE_CHARS = 4000;

const LINE = /^(\d+)\.\s*\[([ x])\]\s*T:\s*(.*?)(?:\s+S:\s*(.*))?$/;

// Parses the numbered plan lines out of a plan.md's text. Returns one entry per well-formed
// `<n>. [ ] T: <name> - <detail> S: <spec ids>` line, with its line index so the loop can rewrite it in place.
export function parsePlanItems(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i]);
    if (!m) continue;
    out.push({
      id: Number(m[1]),
      checked: m[2] === 'x',
      task: m[3].trim(),
      specs: (m[4] ?? '').match(/\d+/g)?.map(Number) ?? [],
      lineIndex: i,
    });
  }
  return out;
}

// The next plan item to hand to the agent: the first unchecked line. The plan is written in priority order
// (see src/bash/prompts/bash-planner.js), so file order is build order.
export function nextPlanItem(items) {
  return items.find((i) => !i.checked) ?? null;
}

const specTag = (specs) => `[${specs.map((n) => `S${n}`).join(', ')}]`;

// The item text handed to every build persona: the task and its specification ids.
function describeItem(item) {
  const specs = item.specs?.length ? [`Specification ids ${item.specs.map((n) => `S${n}`).join(', ')}: start the name of every test with them, as \`${specTag(item.specs)} ...\`.`] : [];
  return [item.task, ...specs].join('\n\n');
}

// The one test file for an item, named from its number, task and specification ids, so every step and retry agrees on it.
export function testFileFor(item) {
  const slug = item.task.split(' - ')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'item';
  const specs = item.specs?.length ? `.${item.specs.map((n) => `s${n}`).join('-')}` : '';
  return `.bish-bash-bosh/tests/${String(item.id).padStart(2, '0')}-${slug}${specs}.test.js`;
}

// Writes the item's starter test file unless an earlier run already left one.
function ensureTestFile(repoDir, item, readFile, writeFile) {
  const path = join(repoDir, testFileFor(item));
  try {
    readFile(path);
  } catch {
    writeFile(path, testFileTemplate(item.task.split(' - ')[0], item.specs ?? []));
  }
}

function clip(failure) {
  return failure.length > MAX_FAILURE_CHARS ? `...${failure.slice(-MAX_FAILURE_CHARS)}` : failure;
}

// Step 1's prompt (src/bosh/prompts/bosh-test-writer.js): write the harness verification tests for this item only,
// no implementation. A retry also carries the failure the harness found under `## Feedback`.
export function buildTestLoopPrompt(item, failure) {
  return testWriterPrompt(describeItem(item), clip(failure ?? ''), testFileFor(item));
}

// Step 2's prompt (src/bosh/prompts/bosh-builder.js): implement the item so the tests written in step 1 pass. A
// retry also carries the failing test output under `## Feedback`, tail-truncated.
export function buildBuildLoopPrompt(item, failure) {
  return builderPrompt(describeItem(item), clip(failure ?? ''), testFileFor(item));
}

// Step 3's prompt (src/bosh/prompts/bosh-inspector.js): independently verify against interview.md/specification.md/
// plan.md and the source, fixing bugs directly. A retry carries the previous failure the same way.
export const TEST_RESULTS_FILE = '.bish-bash-bosh/test-results.txt';

export function buildQaLoopPrompt(item, failure) {
  return inspectorPrompt(describeItem(item), clip(failure ?? ''), testFileFor(item), TEST_RESULTS_FILE);
}

// Ticks a plan item's checkbox by line index, re-reading the file first since something else may have
// changed it meanwhile. Only the checkbox flips, so the item's number and text survive. A line that
// no longer matches (gone, or changed beyond recognition) is left alone rather than erroring.
function markProcessed(planPath, readFile, writeFile, lineIndex) {
  const text = readFile(planPath);
  const lines = text.split('\n');
  if (!LINE.test(lines[lineIndex] ?? '')) return;
  lines[lineIndex] = lines[lineIndex].replace('[ ]', '[x]');
  writeFile(planPath, lines.join('\n'));
}

async function callAgent(adapter, repoDir, prompt, log, persona) {
  log(`${persona} prompt`, prompt);
  let reasoning = '';
  // No `session` key: every call (build or QA) is opted out of session tracking, so each one is a
  // fresh agent context with no memory of any earlier call in this loop (see adapters/*.js: session
  // tracking is opt-in via `Object.hasOwn(req, 'session')`).
  const res = await adapter.run({ prompt, cwd: repoDir, limits: {}, onReasoning: (chunk) => { reasoning += chunk; } });
  if (reasoning) log(`${persona} response`, reasoning);
  return `${res?.transcript ?? ''}\n${reasoning}`;
}

// The Builder reports a defective test by ending its reply with a `TEST FEEDBACK: <what is wrong>` line (it never edits tests).
export function testFeedbackFrom(reply) {
  const hits = [...reply.matchAll(/^[ \t>*-]*TEST FEEDBACK:[ \t]*([\s\S]*)$/gm)];
  return hits.length ? hits[hits.length - 1][1].trim() : '';
}

// Runs the loop against `plan.md` in `repoDir`: finds the next unprocessed item, shows it in colour,
// then for that one item, each agent call a fresh context and every gate bosh's own code, never the
// agent's self-report: (1) WRITE TESTS (src/bosh/prompts/bosh-test-writer.js): the agent writes the harness
// verification tests for the item and nothing else; the harness checks that new/changed test files
// exist and that they run RED (fail) before any implementation, (2) IMPLEMENT (src/bosh/prompts/bosh-builder.js):
// the agent implements the item; the harness runs the full `.bish-bash-bosh/tests/` suite and requires
// GREEN, (3) VERIFY (src/bosh/prompts/bosh-inspector.js): an independent agent checks the work against
// interview.md/specification.md/plan.md and fixes bugs directly; the harness runs the suite again.
// A step that throws or fails its gate is retried (up to MAX_ATTEMPTS) with the failure passed back in
// its prompt; if it never passes, the invocation stops with the item left unticked (a later `bosh` run
// retries it, since the loop always picks the first unticked item). Only once all three steps have
// passed is the item's checkbox ticked. Unlike the Plan Loop there is no human input and no pause: it
// processes every unprocessed item in one call, stopping once none remain (status 'ok') or a step
// gives up (status 'failed'). `log` (see bish-log.js), if given, is called with the full prompt sent for
// each agent call (`'bosh'`) and, if the agent streamed any reasoning text via an opt-in `onReasoning`
// callback, the full accumulated text of that stream (`'agent'`) — never the raw JSON behind either.
// These harness tests are bish-bash-bosh's own verification and never stand in for anything the
// user's objective specifies for itself.
/**
 * @param {{
 *   planPath: string,
 *   specPath?: string,
 *   commit?: (message: string) => unknown,
 *   readFile: (p: string) => string,
 *   writeFile: (p: string, s: string) => void,
 *   say: (s: string) => void,
 *   adapter: { run: (req: object) => Promise<object> },
 *   repoDir?: string,
 *   runTests: (opts: { cwd: string, files?: string[] }) => { ok: boolean, output: string },
 *   listTests: (opts: { cwd: string }) => Map<string, string>,
 *   log?: (source: string, text: string) => void,
 * }} opts
 */
export async function runBuildLoop({
  planPath,
  specPath,
  commit = () => {},
  readFile,
  writeFile,
  say,
  adapter,
  repoDir,
  runTests,
  listTests,
  log = (/** @type {string} */ _source, /** @type {string} */ _text) => {},
}) {
  // Runs one step up to MAX_ATTEMPTS times; `attempt(previousFailure)` returns '' on success or the failure text.
  async function step(label, attempt, seed = '') {
    let previous = seed;
    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      say(`${GREY}${label}${n > 1 ? ` (attempt ${n} of ${MAX_ATTEMPTS}, passing the feedback back)` : ''}...${RESET}\n`);
      let failure;
      try {
        failure = await attempt(previous);
      } catch (e) {
        failure = `${label} threw an error: ${e?.message ?? e}`;
      }
      if (!failure) return '';
      log('bosh/harness', `${label} attempt ${n} got feedback:\n${failure}`);
      previous = failure;
    }
    return previous;
  }

  let processed = 0;
  let spec;
  for (;;) {
    const text = readFile(planPath);
    const items = parsePlanItems(text);
    const next = nextPlanItem(items);
    if (!next) {
      if (items.length === 0) return { status: 'empty', processed };
      return { status: 'ok', processed, total: items.length, spec };
    }
    say(`\n${CYAN}${next.task.split(' - ')[0]}${RESET}\n`);
    const fail = (output, persona) => ({ status: 'failed', processed, item: next, output, persona, spec });

    // The Builder never edits tests: when it finds one defective it sends feedback, and the Test Writer fixes it
    // before the Builder runs again (at most MAX_TEST_ROUNDS times per item).
    ensureTestFile(repoDir, next, readFile, writeFile);
    let testFeedback = '';
    let greenFailure = '';
    let latestResults = '';
    for (let round = 1; ; round++) {
      const before = listTests({ cwd: repoDir });
      // An item whose implementation survived an interrupted earlier run can never go red. So tests that still
      // pass on the retry are accepted (the Inspector then checks the work) instead of failing the item.
      let alreadyGreen = 0;
      const redFailure = await step('Test Writer', async (previous) => {
        await callAgent(adapter, repoDir, buildTestLoopPrompt(next, previous), log, 'bosh/test-writer');
        const after = listTests({ cwd: repoDir });
        const touched = [...after].filter(([path, stamp]) => before.get(path) !== stamp).map(([path]) => path);
        if (touched.length === 0) return 'No test file under .bish-bash-bosh/tests/ was added or changed: write or fix at least one test for this item.';
        const red = runTests({ cwd: repoDir, files: touched });
        const broken = red.ok ? '' : describeTestErrors(red.output);
        if (broken) return `${broken}Fix the tests so they run and fail on an assertion because the item's behaviour is missing.\n${red.output}`;
        if (red.ok && testFeedback) return '';
        if (red.ok && ++alreadyGreen >= 2) {
          log('bosh/harness', `The new tests (${touched.join(', ')}) still pass before any implementation; accepting them, the item may already be implemented from an earlier run.`);
          return '';
        }
        if (red.ok) return `The new tests (${touched.join(', ')}) already pass before any implementation, so they prove nothing: make them fail for the right reason (the item's behaviour missing). If the project's files already implement this item, say so in your reply and keep the tests as they are.\n${red.output}`;
        return '';
      }, testFeedback);
      if (redFailure) return fail(redFailure, 'Test Writer');
      testFeedback = '';

      greenFailure = await step('Builder', async (previous) => {
        const reply = await callAgent(adapter, repoDir, buildBuildLoopPrompt(next, previous), log, 'bosh/builder');
        testFeedback = testFeedbackFrom(reply);
        if (testFeedback) return '';
        const result = runTests({ cwd: repoDir });
        latestResults = result.output;
        return result.ok ? '' : `${describeTestErrors(result.output)}${result.output}`;
      });
      if (greenFailure || !testFeedback) break;
      log('bosh/harness', `Builder sent feedback on the tests (round ${round} of ${MAX_TEST_ROUNDS}):\n${testFeedback}`);
      if (round >= MAX_TEST_ROUNDS) return fail(`The Builder still reports a defective test after ${MAX_TEST_ROUNDS} fixes: ${testFeedback}`, 'Builder');
    }
    if (greenFailure) return fail(greenFailure, 'Builder');

    const qaFailure = await step('Inspector', async (previous) => {
      // The Inspector reads the latest full-suite output from a results file the harness writes before it runs.
      writeFile(join(repoDir, TEST_RESULTS_FILE), latestResults);
      await callAgent(adapter, repoDir, buildQaLoopPrompt(next, previous), log, 'bosh/inspector');
      const result = runTests({ cwd: repoDir });
      latestResults = result.output;
      if (result.ok && specPath) spec = updateSpecStatus(specPath, readFile, writeFile, result.output);
      return result.ok ? '' : result.output;
    });
    if (qaFailure) return fail(qaFailure, 'Inspector');

    markProcessed(planPath, readFile, writeFile, next.lineIndex);
    processed++;
    const [name, ...detail] = next.task.split(' - ');
    commit([`bosh: ${subject(name)}`, detail.join(' - '), next.specs.length ? `Specification items: ${next.specs.join(', ')}` : '', spec ? `Specification status: ${spec.verified.length} verified, ${spec.failing.length} failing, ${spec.uncovered.length} untested` : ''].filter(Boolean).join('\n\n'));
  }
}
