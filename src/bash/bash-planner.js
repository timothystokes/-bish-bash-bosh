// The Plan Pass: one agent call that reads the whole `.bish-bash-bosh/specification.md` and the project's current
// code and writes (or refreshes) `.bish-bash-bosh/plan.md`, a prioritised checklist of concrete construction
// tasks, which `-bosh` then works through from the top. The plan is disposable: running `-bash` again simply
// re-plans against the code as it now stands. The harness only checks that the result has at least one item.
import plannerPrompt from './prompts/bash-planner.js';
import { parsePlanItems } from '../bosh/bosh-build-loop.js';

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

// The planner's prompt: src/bash/prompts/bash-planner.js (what a plan item is, then the procedure).
export function buildPlanPrompt() {
  return plannerPrompt();
}

// One planning call in a fresh context (no `session` key), then a check that plan.md holds at least one item in the
// expected format. Throws, with the agent's last output, when it does not so the owner can see why.
/**
 * @param {{
 *   planPath: string,
 *   readFile: (p: string) => string,
 *   say: (s: string) => void,
 *   adapter: { run: (req: object) => Promise<{ transcript?: string }> },
 *   repoDir?: string,
 *   log?: (source: string, text: string) => void,
 * }} opts
 */
export async function runPlanLoop({ planPath, readFile, say, adapter, repoDir, log = (/** @type {string} */ _source, /** @type {string} */ _text) => {} }) {
  say('\x1b[90mPlanner: working from the whole specification and the current code...\x1b[0m\n');
  const prompt = buildPlanPrompt();
  log('bash/planner prompt', prompt);
  let reasoning = '';
  const result = await adapter.run({ prompt, cwd: repoDir, limits: {}, onReasoning: (/** @type {string} */ chunk) => { reasoning += chunk; } });
  const response = reasoning || result?.transcript || '';
  if (response) log('bash/planner response', response);
  const items = parsePlanItems(readFile(planPath));
  if (items.length === 0) {
    throw new Error(`the agent wrote no plan items to ${planPath} (expected lines like \`1. [ ] T: <name> - <detail> S: <ids>\`)${response ? `. Last agent output:\n${response.slice(-1500)}` : ''}`);
  }
  const open = items.filter((i) => !i.checked);
  return { status: 'ok', items: items.length, open: open.length, first: open[0]?.task.split(' - ')[0] };
}
