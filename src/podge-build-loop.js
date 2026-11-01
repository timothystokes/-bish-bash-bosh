// The Build Loop: a deterministic walk through `.hodgepodge/plan.md`'s dependency-ordered checklist
// (see prompts/plan-loop.md for the format the Plan Loop's agent writes into it: one line per item,
// `- [ ] Phase: <phase> Task: <task>`), with a single checkbox ticked only once that item has been
// implemented, independently verified and both gates have passed. Unlike the Interview Loop there is
// no human input: each unprocessed item is simply handed to the agent in turn. Every call — build or
// QA — starts a fresh agent context (no continuing session, unlike `hodge`/`gepo`): the agent is
// instructed to read `.hodgepodge/plan.md` and the project's own source/test files rather than rely
// on memory of earlier calls.
import { loadModePrompt } from './prompts.js';

const CYAN = '\x1b[1;36m';
const GREY = '\x1b[90m';
const RESET = '\x1b[0m';

const LINE = /^-\s*\[([ x])\]\s*Phase:\s*(.*?)\s*Task:\s*(.*)$/;

// Parses the phase/task checklist lines out of a plan.md's text. Returns one entry per well-formed
// `- [ ] Phase: <phase> Task: <task>` line, with its line index so the loop can rewrite it in place.
export function parsePlanItems(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i]);
    if (!m) continue;
    out.push({ checked: m[1] === 'x', phase: m[2].trim(), task: m[3].trim(), lineIndex: i });
  }
  return out;
}

// The next plan item to hand to the agent: the first line not yet checked.
export function nextPlanItem(items) {
  return items.find((i) => !i.checked) ?? null;
}

// The build agent's prompt for one item: prompts/build-loop.md's instructions (test-driven: write a
// failing test first, using the bundled `.hodgepodge/test-harness.js`, then implement), prefaced onto
// this item's phase and task. The agent is expected to implement the item in the project root; it is
// not expected to edit specification.md, interview.md or plan.md.
export function buildBuildLoopPrompt(item) {
  return [loadModePrompt('build-loop'), '## Phase', item.phase, '## Task', item.task].join('\n\n');
}

// The QA agent's prompt for the same item, called only once the build call's test-gate has passed:
// prompts/qa-loop.md's instructions (independently verify against interview.md/specification.md/
// plan.md and the source, fix bugs directly rather than merely reporting them), prefaced onto the
// same phase and task.
export function buildQaLoopPrompt(item) {
  return [loadModePrompt('qa-loop'), '## Phase', item.phase, '## Task', item.task].join('\n\n');
}

// Renders one plan item line, checked or not, with its current phase/task text.
function renderLine(checked, phase, task) {
  return `- [${checked ? 'x' : ' '}] Phase: ${phase} Task: ${task}`;
}

// Ticks a plan item's checkbox by line index, re-reading the file first since something else may have
// changed it meanwhile. A line that no longer matches (gone, or changed beyond recognition) is left
// alone rather than erroring.
function markProcessed(planPath, readFile, writeFile, lineIndex, phase, task) {
  const text = readFile(planPath);
  const lines = text.split('\n');
  if (!LINE.test(lines[lineIndex] ?? '')) return;
  lines[lineIndex] = renderLine(true, phase, task);
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
// write a failing test then implement it), (2) `runTests` — podge's own code, never the agent's
// self-report — runs the full `.hodgepodge/tests/` suite; a failure here stops this invocation with
// the item left unticked (a later `podge` run naturally retries it, since the loop always picks the
// first unticked item), (3) a fresh-context QA agent call (prompts/qa-loop.md, independently verifies
// against interview.md/specification.md/plan.md and the source, and is expected to fix any bug it
// finds directly), (4) `runTests` again as the final gate; only once both gates have passed is the
// item's checkbox ticked. Unlike the Plan Loop there is no human input and no pause: it processes
// every unprocessed item in one call, stopping only once none remain (status 'ok') or a gate fails
// (status 'failed'). `log` (see hodge-log.js), if given, is called with the full prompt sent for each
// agent call (`'podge'`) and, if the agent streamed any reasoning text via an opt-in `onReasoning`
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
    if (!next) return { status: 'ok', processed };
    say(`\n${CYAN}Phase: ${next.phase}${RESET}\n`);

    say(`${GREY}Thinking...${RESET}\n`);
    await callAgent(adapter, repoDir, buildBuildLoopPrompt(next), log, 'podge');

    let result = runTests({ cwd: repoDir });
    if (!result.ok) {
      log('podge', `tests failed after implementation:\n${result.output}`);
      return { status: 'failed', processed, item: next, output: result.output };
    }

    say(`${GREY}Verifying...${RESET}\n`);
    await callAgent(adapter, repoDir, buildQaLoopPrompt(next), log, 'podge');

    result = runTests({ cwd: repoDir });
    if (!result.ok) {
      log('podge', `tests failed after verification:\n${result.output}`);
      return { status: 'failed', processed, item: next, output: result.output };
    }

    markProcessed(planPath, readFile, writeFile, next.lineIndex, next.phase, next.task);
    processed++;
  }
}
