// Spec status from the Inspector's verdict: when the Inspector approves an item it lists the specification items
// it verified against the project's own files (`VERIFIED: S3, S5`). The harness ticks those that belong to the item
// in specification.md. Nothing is ever unticked here and test names carry no meaning for it.
import { parseSpecificationItems } from '../bash/bash-planner.js';

// The Inspector ends its reply with `APPROVED` (optionally followed by a `VERIFIED: S1, S2` line) or with a
// `FEEDBACK: <what to change>` section. Returns { approved, feedback, verified }.
export function parseVerdict(reply) {
  const feedback = [...reply.matchAll(/^[ \t>*-]*FEEDBACK:[ \t]*([\s\S]*)$/gm)].pop()?.[1].trim() ?? '';
  const approved = /^[ \t>*-]*APPROVED\b/m.test(reply) && !feedback;
  const verified = (/^[ \t>*-]*VERIFIED:[ \t]*(.*)$/m.exec(reply)?.[1].match(/\d+/g) ?? []).map(Number);
  return { approved, feedback, verified };
}

// Ticks the given specification items and returns the ids in each state.
/** @returns {{ verified: number[], uncovered: number[] }} */
export function tickSpecs(specPath, readFile, writeFile, ids) {
  const text = readFile(specPath);
  const lines = text.split('\n');
  const wanted = new Set(ids);
  const status = { verified: [], uncovered: [] };
  for (const item of parseSpecificationItems(text)) {
    if (wanted.has(item.id)) lines[item.lineIndex] = lines[item.lineIndex].replace('[ ]', '[x]');
    (item.checked || wanted.has(item.id) ? status.verified : status.uncovered).push(item.id);
  }
  const next = lines.join('\n');
  if (next !== text) writeFile(specPath, next);
  return status;
}
