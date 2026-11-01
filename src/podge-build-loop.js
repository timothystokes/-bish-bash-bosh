// The Build Loop: a deterministic walk through `.hodgepodge/plan.md`'s dependency-ordered checklist
// (see prompts/plan-loop.md for the format the Plan Loop's agent writes into it: one line per item,
// `- [ ] Phase: <phase> Task: <task>`), with a single checkbox ticked only once that item has been
// fully handed to and processed by the agent. Unlike the Interview Loop there is no human input: each
// unprocessed item is simply handed to the agent in turn (prompts/build-loop.md's prompt). The agent's
// job is to implement that one item — the actual files and configuration in the project root; the
// loop itself never writes source files, only ticks the checkbox once the agent has finished.
import { loadModePrompt, loadBuildIntro } from './prompts.js';

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

// The agent's prompt for one item: prompts/build-loop.md's instructions, prefaced onto this item's
// phase and task. The agent is expected to implement the item in the project root; it is not expected
// to edit specification.md, interview.md or plan.md. `includeIntro` prefaces prompts/build-intro.md
// onto the very top of all of that: the caller passes it only for the first item of a brand-new
// session (see runBuildLoop below), never for a later item or a restart that resumes the same
// persisted session.
export function buildBuildLoopPrompt(item, { includeIntro = false } = {}) {
  const parts = [];
  if (includeIntro) parts.push(loadBuildIntro().trimEnd());
  parts.push(loadModePrompt('build-loop'), '## Phase', item.phase, '## Task', item.task);
  return parts.join('\n\n');
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

// Runs the loop against `plan.md` in `repoDir`: finds the next unprocessed item, shows it in colour,
// prints a "Thinking..." line, hands exactly that item to the agent (one call per item,
// prompts/build-loop.md's job, expected to implement it as real files/configuration in the project
// root), then ticks the item's checkbox once the agent has finished. Unlike the Plan Loop there is no
// human input and no pause: it processes every unprocessed item in one call, stopping only once none
// remain (status 'ok'). `loadSession`/`saveSession` thread one continuing agent session through every
// item, and across separate `podge` invocations, so the agent keeps the whole conversation's context
// rather than starting fresh each time; the very first item of a brand-new session (no session
// persisted yet) also prefaces prompts/build-intro.md onto that one call only — never again for a
// later item or a restart that resumes the same session. `log` (see hodge-log.js), if given, is called
// once per item with the full prompt sent (`'podge'`) and, if the agent streamed any reasoning text via
// an opt-in `onReasoning` callback, the full accumulated text of that stream (`'agent'`) — never the
// raw JSON behind either.
/**
 * @param {{
 *   planPath: string,
 *   readFile: (p: string) => string,
 *   writeFile: (p: string, s: string) => void,
 *   say: (s: string) => void,
 *   adapter: { run: (req: object) => Promise<{ session?: unknown }> },
 *   repoDir?: string,
 *   loadSession?: () => unknown,
 *   saveSession?: (session: unknown) => void,
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
  loadSession = () => undefined,
  saveSession = (/** @type {unknown} */ _session) => {},
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
    const session = loadSession();
    const prompt = buildBuildLoopPrompt(next, { includeIntro: session === undefined });
    log('podge', prompt);
    let reasoning = '';
    const result = await adapter.run({
      prompt,
      cwd: repoDir,
      limits: {},
      session,
      onReasoning: (/** @type {string} */ chunk) => { reasoning += chunk; },
    });
    if (reasoning) log('agent', reasoning);
    saveSession(result.session);
    markProcessed(planPath, readFile, writeFile, next.lineIndex, next.phase, next.task);
    processed++;
  }
}
