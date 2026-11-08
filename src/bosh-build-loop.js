// The Build Loop: a deterministic walk through `.bish-bash-bosh/plan.md`'s dependency-ordered checklist
// (see prompts/plan-loop.md for the format the Plan Loop's agent writes into it: one numbered line per
// item, `<n>. [ ] Phase: <phase> Task: <task> Depends: <item numbers or None>`), with a single checkbox ticked only once that item has been
// implemented, independently verified and both gates have passed. Unlike the Interview Loop there is
// no human input: each unprocessed item is simply handed to the agent in turn. Every call — build or
// QA — starts a fresh agent context (no continuing session, unlike `bish`/`bash`): the agent is
// instructed to read `.bish-bash-bosh/plan.md` and the project's own source/test files rather than rely
// on memory of earlier calls.
import { loadModePrompt } from './prompts.js';

const CYAN = '\x1b[1;36m';
const GREY = '\x1b[90m';
const RESET = '\x1b[0m';

// A QA attempt that throws or leaves the suite failing is retried with that failure as input, up to this many attempts.
export const MAX_QA_ATTEMPTS = 3;
const MAX_FAILURE_CHARS = 4000;

const LINE = /^(\d+)\.\s*\[([ x])\]\s*Phase:\s*(.*?)\s*Task:\s*(.*?)(?:\s*Depends:\s*(.*))?$/;

// Parses the numbered plan lines out of a plan.md's text. Returns one entry per well-formed
// `<n>. [ ] Phase: <phase> Task: <task> Depends: <item numbers or None>` line, with its line index so
// the loop can rewrite it in place. `Depends` is optional (missing or `None` = no dependencies).
export function parsePlanItems(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i]);
    if (!m) continue;
    out.push({
      id: Number(m[1]),
      checked: m[2] === 'x',
      phase: m[3].trim(),
      task: m[4].trim(),
      dependsOn: (m[5] ?? '').match(/\d+/g)?.map(Number) ?? [],
      lineIndex: i,
    });
  }
  return out;
}

// The next plan item to hand to the agent: the first unchecked line whose dependencies are all
// checked. A dependency naming an item number that does not exist is ignored rather than blocking.
export function nextPlanItem(items) {
  const open = new Set(items.filter((i) => !i.checked).map((i) => i.id));
  return items.find((i) => !i.checked && !i.dependsOn.some((d) => d !== i.id && open.has(d))) ?? null;
}

// The build agent's prompt for one item: prompts/build-loop.md's instructions (test-driven: write a
// failing test first, using the bundled `.bish-bash-bosh/test-harness.js`, then implement), prefaced onto
// this item's phase and task. The agent is expected to implement the item in the project root; it is
// not expected to edit specification.md, interview.md or plan.md.
export function buildBuildLoopPrompt(item) {
  return [loadModePrompt('build-loop'), '## Phase', item.phase, '## Task', item.task].join('\n\n');
}

// The QA agent's prompt for the same item, called only once the build call's test-gate has passed:
// prompts/qa-loop.md's instructions (independently verify against interview.md/specification.md/
// plan.md and the source, fix bugs directly rather than merely reporting them), prefaced onto the
// same phase and task. A retry after a failed QA attempt also carries that failure (an error thrown
// by the call, or the test output of the gate after it) under `## Previous Failure`, tail-truncated.
export function buildQaLoopPrompt(item, failure) {
  const parts = [loadModePrompt('qa-loop'), '## Phase', item.phase, '## Task', item.task];
  if (failure) parts.push('## Previous Failure', failure.length > MAX_FAILURE_CHARS ? `...${failure.slice(-MAX_FAILURE_CHARS)}` : failure);
  return parts.join('\n\n');
}

// Ticks a plan item's checkbox by line index, re-reading the file first since something else may have
// changed it meanwhile. Only the checkbox flips, so the item's number and Depends survive. A line that
// no longer matches (gone, or changed beyond recognition) is left alone rather than erroring.
function markProcessed(planPath, readFile, writeFile, lineIndex) {
  const text = readFile(planPath);
  const lines = text.split('\n');
  if (!LINE.test(lines[lineIndex] ?? '')) return;
  lines[lineIndex] = lines[lineIndex].replace('[ ]', '[x]');
  writeFile(planPath, lines.join('\n'));
}

async function callAgent(adapter, repoDir, prompt, log, logSource) {
  log(logSource, prompt);
  let reasoning = '';
  // No `session` key: every call (build or QA) is opted out of session tracking, so each one is a
  // fresh agent context with no memory of any earlier call in this loop (see adapters/*.js: session
  // tracking is opt-in via `Object.hasOwn(req, 'session')`).
  await adapter.run({ prompt, cwd: repoDir, limits: {}, onReasoning: (chunk) => { reasoning += chunk; } });
  if (reasoning) log('agent', reasoning);
}

// Runs the loop against `plan.md` in `repoDir`: finds the next unprocessed item, shows it in colour,
// then for that one item: (1) a fresh-context build agent call (prompts/build-loop.md, expected to
// write a failing test then implement it), (2) `runTests` — bosh's own code, never the agent's
// self-report — runs the full `.bish-bash-bosh/tests/` suite; a failure here stops this invocation with
// the item left unticked (a later `bosh` run naturally retries it, since the loop always picks the
// first unticked item), (3) a fresh-context QA agent call (prompts/qa-loop.md, independently verifies
// against interview.md/specification.md/plan.md and the source, and is expected to fix any bug it
// finds directly), (4) `runTests` again as the final gate; if that QA call throws or the gate fails,
// the QA step is retried (up to MAX_QA_ATTEMPTS) with the error/test output passed in as part of its
// prompt; only once both gates have passed is the item's checkbox ticked. Unlike the Plan Loop there is no human input and no pause: it processes
// every unprocessed item in one call, stopping only once none remain (status 'ok') or a gate fails
// (status 'failed'). `log` (see bish-log.js), if given, is called with the full prompt sent for each
// agent call (`'bosh'`) and, if the agent streamed any reasoning text via an opt-in `onReasoning`
// callback, the full accumulated text of that stream (`'agent'`) — never the raw JSON behind either.
/**
 * @param {{
 *   planPath: string,
 *   readFile: (p: string) => string,
 *   writeFile: (p: string, s: string) => void,
 *   say: (s: string) => void,
 *   adapter: { run: (req: object) => Promise<object> },
 *   repoDir?: string,
 *   runTests: (opts: { cwd: string }) => { ok: boolean, output: string },
 *   log?: (source: string, text: string) => void,
 * }} opts
 */
export async function runBuildLoop({
  planPath,
  readFile,
  writeFile,
  say,
  adapter,
  repoDir,
  runTests,
  log = (/** @type {string} */ _source, /** @type {string} */ _text) => {},
}) {
  let processed = 0;
  for (;;) {
    const text = readFile(planPath);
    const items = parsePlanItems(text);
    const next = nextPlanItem(items);
    if (!next) {
      const stuck = items.find((i) => !i.checked);
      if (!stuck) return { status: 'ok', processed };
      return { status: 'blocked', processed, item: stuck, output: `no item can start: every unticked item depends on another unticked item (${items.filter((i) => !i.checked).map((i) => `${i.id} needs ${i.dependsOn.join(', ')}`).join('; ')})` };
    }
    say(`\n${CYAN}Phase: ${next.phase}${RESET}\n`);

    say(`${GREY}Thinking...${RESET}\n`);
    await callAgent(adapter, repoDir, buildBuildLoopPrompt(next), log, 'bosh');

    let result = runTests({ cwd: repoDir });
    if (!result.ok) {
      log('bosh', `tests failed after implementation:\n${result.output}`);
      return { status: 'failed', processed, item: next, output: result.output };
    }

    let previous = '';
    let failure = '';
    let failed = false;
    for (let attempt = 1; attempt <= MAX_QA_ATTEMPTS; attempt++) {
      say(`${GREY}Verifying${attempt > 1 ? ` (attempt ${attempt} of ${MAX_QA_ATTEMPTS}, passing the previous failure back)` : ''}...${RESET}\n`);
      failed = false;
      try {
        await callAgent(adapter, repoDir, buildQaLoopPrompt(next, previous), log, 'bosh');
        result = runTests({ cwd: repoDir });
        failed = !result.ok;
        failure = result.output;
      } catch (e) {
        failed = true;
        failure = `QA step threw an error: ${e?.message ?? e}`;
      }
      if (!failed) break;
      log('bosh', `QA attempt ${attempt} failed:\n${failure}`);
      previous = failure;
    }
    if (failed) return { status: 'failed', processed, item: next, output: failure };

    markProcessed(planPath, readFile, writeFile, next.lineIndex);
    processed++;
  }
}
