// The Plan Loop: a deterministic walk through `.bish-bash-bosh/specification.md`'s numbered-line format
// (see src/bish/templates/bish-specification.md): one line per item, `<n>. [ ] C: <constraint> B: <benefit>`,
// with a single checkbox ticked only once that item has been fully handed to and processed by the
// agent. Unlike the Interview Loop there is no human input: each unprocessed item is simply handed to
// the agent in turn (src/bash/prompts/bash-loop.md's prompt). The agent's job is to turn it into
// dependency-ordered checklist items in `.bish-bash-bosh/plan.md`; the loop itself never writes plan.md.
import { loadModePrompt, loadPlanIntro } from '../shared/prompts.js';

const CYAN = '\x1b[1;36m';
const GREY = '\x1b[90m';
const RESET = '\x1b[0m';

const LINE = /^(\d+)\.\s*\[([ x])\]\s*C\s*(?:\([^)]*\))?:\s*(.*?)\s*B\s*(?:\([^)]*\))?:\s*(.*)$/;

// Parses the numbered constraint/benefit lines out of a specification.md's text. Returns one entry
// per well-formed `<n>. [ ] C: <constraint> B: <benefit>` line, with its line index so the loop can
// rewrite it in place. Tolerates a parenthetical remark between `C`/`B` and `:` (e.g. the `C (Q1):`
// question reference the Interview Loop writes, matching its own `A (...):` leniency), so a line is never silently dropped over a label phrased slightly
// differently.
export function parseSpecificationItems(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i]);
    if (!m) continue;
    out.push({
      id: Number(m[1]),
      checked: m[2] === 'x',
      constraint: m[3].trim(),
      benefit: m[4].trim(),
      lineIndex: i,
    });
  }
  return out;
}

// The next specification item to hand to the agent: the first line not yet checked.
export function nextSpecificationItem(items) {
  return items.find((i) => !i.checked) ?? null;
}

// The agent's prompt for one item: src/bash/prompts/bash-loop.md's instructions, prefaced onto this item's
// constraint and benefit. The agent is expected to turn it into checklist items in
// `.bish-bash-bosh/plan.md`; it is not expected to edit specification.md or interview.md. `includeIntro`
// prefaces src/bash/prompts/bash-intro.md onto the very top of all of that: the caller passes it only for the
// first item of a brand-new session (see runPlanLoop below), never for a later item or a restart that
// resumes the same persisted session.
export function buildPlanLoopPrompt(item, { includeIntro = false } = {}) {
  const parts = [];
  if (includeIntro) parts.push(loadPlanIntro().trimEnd());
  parts.push(loadModePrompt('plan-loop'), '## Constraint', item.constraint, '## Benefit', item.benefit);
  return parts.join('\n\n');
}

// Ticks a specification item's checkbox by id, re-reading the file first since something else may
// have changed it meanwhile. A line that is gone is left alone rather than erroring.
function markProcessed(specificationPath, readFile, writeFile, id) {
  const text = readFile(specificationPath);
  const item = parseSpecificationItems(text).find((x) => x.id === id);
  if (!item) return;
  const lines = text.split('\n');
  lines[item.lineIndex] = lines[item.lineIndex].replace('[ ]', '[x]');
  writeFile(specificationPath, lines.join('\n'));
}

// Runs the loop against `specification.md` in `repoDir`: finds the next unprocessed item, shows it in
// colour, prints a "Thinking..." line, hands exactly that item to the agent (one call per item,
// src/bash/prompts/bash-loop.md's job, expected to append dependency-ordered checklist items to
// `.bish-bash-bosh/plan.md`), then ticks the item's checkbox once the agent has finished. Unlike the
// Interview Loop there is no human input and no pause: it processes every unprocessed item in one
// call, stopping only once none remain (status 'ok'). `loadSession`/`saveSession` thread one
// continuing agent session through every item, and across separate `bash` invocations, so the agent
// keeps the whole conversation's context rather than starting fresh each time; the very first item of
// a brand-new session (no session persisted yet) also prefaces src/bash/prompts/bash-intro.md onto that one
// call only — never again for a later item or a restart that resumes the same session. `log` (see
// bish-log.js), if given, is called once per item with the full prompt sent (`'bash'`) and, if the
// agent streamed any reasoning text via an opt-in `onReasoning` callback, the full accumulated text of
// that stream (`'agent'`) — never the raw JSON behind either.
/**
 * @param {{
 *   specificationPath: string,
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
export async function runPlanLoop({
  specificationPath,
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
    const text = readFile(specificationPath);
    const items = parseSpecificationItems(text);
    const next = nextSpecificationItem(items);
    if (!next) return { status: 'ok', processed };
    say(`\n${CYAN}C: ${next.constraint}${RESET}\n`);
    say(`${GREY}Thinking...${RESET}\n`);
    const session = loadSession();
    const prompt = buildPlanLoopPrompt(next, { includeIntro: session === undefined });
    log('bash', prompt);
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
    markProcessed(specificationPath, readFile, writeFile, next.id);
    processed++;
  }
}
