// Spec status from test evidence: a harness test whose name starts with `[S3]` (or `[S3, S5]`) vouches for those
// specification.md item numbers. After a green full-suite run, a spec item is ticked when it has at least one tagged
// test and every tagged test passed; it is unticked when a tagged test fails. Items with no tagged test are left as
// they are and reported as uncovered. Reads Node's spec-reporter output (`✔ name (3ms)` / `✖ name (3ms)`).
import { parseSpecificationItems } from '../bash/bash-plan-loop.js';

const RESULT = /^\s*(✔|✖)\s+(.+?)(?:\s+\([\d.]+ms\))?\s*$/;
const TAG = /^\[((?:\s*S\d+\s*,?)+)\]/;

/** @param {string} output @returns {{ passed: Set<number>, failed: Set<number> }} */
export function parseSpecResults(output) {
  const passed = new Set();
  const failed = new Set();
  for (const line of output.split('\n')) {
    const m = RESULT.exec(line);
    if (!m) continue;
    const tag = TAG.exec(m[2]);
    if (!tag) continue;
    for (const id of tag[1].match(/\d+/g)) (m[1] === '✔' ? passed : failed).add(Number(id));
  }
  return { passed, failed };
}

// Rewrites specification.md's checkboxes from `output` (a full-suite run) and returns the ids in each state.
/** @returns {{ verified: number[], failing: number[], uncovered: number[] }} */
export function updateSpecStatus(specPath, readFile, writeFile, output) {
  const text = readFile(specPath);
  const lines = text.split('\n');
  const { passed, failed } = parseSpecResults(output);
  const status = { verified: [], failing: [], uncovered: [] };
  for (const item of parseSpecificationItems(text)) {
    const state = failed.has(item.id) ? 'failing' : passed.has(item.id) ? 'verified' : 'uncovered';
    status[state].push(item.id);
    if (state === 'uncovered') continue;
    const line = lines[item.lineIndex];
    lines[item.lineIndex] = state === 'verified' ? line.replace('[ ]', '[x]') : line.replace('[x]', '[ ]');
  }
  const next = lines.join('\n');
  if (next !== text) writeFile(specPath, next);
  return status;
}
