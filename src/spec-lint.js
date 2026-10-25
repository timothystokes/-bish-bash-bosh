import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTestPlan } from './test-plan-gate.js';

/** @typedef {{ok: boolean, problems: string[]}} LintResult */

/**
 * Titles are the `# ` lines outside code fences.
 * @param {string} text
 * @returns {string[]}
 */
function titles(text) {
  let fenced = false;
  /** @type {string[]} */
  const out = [];
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && /^# /.test(line)) out.push(line);
  }
  return out;
}

/**
 * Deterministic structure check of `specs/*.md`: non-empty, one `# Spec: ...` title
 * (one decision per file), unique titles, and every spec mapped in `tests/PLAN.md`.
 * @param {string} repoDir
 * @returns {LintResult}
 */
export function lintSpecs(repoDir) {
  /** @type {string[]} */
  const problems = [];
  const specsDir = join(repoDir, 'specs');
  const files = existsSync(specsDir) ? readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort() : [];
  if (files.length === 0) return { ok: false, problems: ['specs/ has no *.md specs'] };

  /** @type {Map<string, string[]>} */
  const byTitle = new Map();
  for (const f of files) {
    const path = `specs/${f}`;
    const text = readFileSync(join(specsDir, f), 'utf8');
    if (text.trim() === '') {
      problems.push(`${path}: spec is empty`);
      continue;
    }
    const ts = titles(text);
    if (ts.length === 0 || !/^# Spec: \S/.test(ts[0]) || text.trimStart().indexOf(ts[0]) !== 0) {
      problems.push(`${path}: must start with a "# Spec: <name>" title`);
      continue;
    }
    if (ts.length > 1) problems.push(`${path}: one decision per file, found ${ts.length} top-level titles`);
    const key = ts[0].slice('# Spec:'.length).trim().toLowerCase();
    byTitle.set(key, [...(byTitle.get(key) ?? []), path]);
  }
  for (const [title, paths] of byTitle) {
    if (paths.length > 1) problems.push(`duplicate title "${title}": ${paths.join(', ')}`);
  }

  const planPath = join(repoDir, 'tests', 'PLAN.md');
  if (!existsSync(planPath)) problems.push('tests/PLAN.md is missing');
  else {
    const mapped = parseTestPlan(readFileSync(planPath, 'utf8'));
    for (const f of files) {
      if ((mapped.get(`specs/${f}`) ?? []).length === 0) problems.push(`specs/${f}: not mapped to a test in tests/PLAN.md`);
    }
  }
  return { ok: problems.length === 0, problems };
}
