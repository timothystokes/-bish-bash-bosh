import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintSpecs } from './spec-lint.js';
import { parseTestPlan } from './test-plan-gate.js';

/** Fine-grained means at least this many atomic, testable requirements per spec. */
export const MIN_REQUIREMENTS = 3;

const NEGATIVE = /\b(throws?|rejects?|errors?|invalid|fails?|refus(?:e|es|ed)|must not|never)\b/i;
const PLACEHOLDER = /\b(TBD|TODO|FIXME)\b|\?\?|<[^>\n]+>/;

/**
 * @param {string} repoDir
 * @returns {boolean} true when the repo was seeded with an objective kit (`hodge init --seed objective`)
 */
export function hasObjectiveKit(repoDir) {
  return existsSync(join(repoDir, 'objective'));
}

/**
 * Text with fenced blocks and inline code removed.
 * @param {string} text
 */
function stripCode(text) {
  let fenced = false;
  const kept = [];
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) kept.push(line.replace(/`[^`]*`/g, ''));
  }
  return kept.join('\n');
}

/**
 * Bullets under each `## Heading` (outside code fences), keyed by lower-cased heading.
 * @param {string} text
 * @returns {Map<string, string[]>}
 */
function bulletsBySection(text) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  let fenced = false;
  /** @type {string | null} */
  let current = null;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) {
      current = h[1].toLowerCase();
      out.set(current, out.get(current) ?? []);
    } else if (current && /^[-*] \S/.test(line)) out.get(current)?.push(line.slice(2).trim());
  }
  return out;
}

/**
 * @param {string} s
 */
const brief = (s) => (s.length > 60 ? `${s.slice(0, 57)}...` : s);

/**
 * Deterministic "enough to leave the conversation" check: the requirements are captured at a fine grain.
 * Mirrors objective/READINESS.md.
 * @param {string} repoDir
 * @returns {{ready: boolean, gaps: string[]}}
 */
export function checkReadiness(repoDir) {
  const lint = lintSpecs(repoDir);
  const gaps = [...lint.problems];
  const specsDir = join(repoDir, 'specs');
  const files = existsSync(specsDir) ? readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort() : [];

  for (const f of files) {
    const path = `specs/${f}`;
    const text = readFileSync(join(specsDir, f), 'utf8');
    if (PLACEHOLDER.test(stripCode(text))) gaps.push(`${path}: placeholder text left (TBD/TODO/??/<angle>)`);
    const sections = bulletsBySection(text);
    const reqs = sections.get('requirements') ?? [];
    const examples = sections.get('examples') ?? [];
    const scope = sections.get('out of scope') ?? [];
    if (reqs.length < MIN_REQUIREMENTS) gaps.push(`${path}: ${reqs.length} requirements, need at least ${MIN_REQUIREMENTS}`);
    for (const r of reqs) {
      const musts = r.match(/\bmust\b/gi)?.length ?? 0;
      if (musts === 0) gaps.push(`${path}: requirement not testable (no "must"): "${brief(r)}"`);
      else if (musts > 1) gaps.push(`${path}: requirement is compound (${musts} "must"s), split it: "${brief(r)}"`);
    }
    const needed = Math.ceil(reqs.length / 2);
    if (examples.length < needed) gaps.push(`${path}: ${examples.length} examples, need at least ${needed} (one per two requirements)`);
    if (![...reqs, ...examples].some((s) => NEGATIVE.test(s))) gaps.push(`${path}: no failure or negative path in requirements or examples`);
    if (scope.length === 0) gaps.push(`${path}: Out of scope is empty`);
  }

  const planPath = join(repoDir, 'tests', 'PLAN.md');
  if (existsSync(planPath)) {
    for (const tests of parseTestPlan(readFileSync(planPath, 'utf8')).values()) {
      for (const t of tests) if (!existsSync(join(repoDir, t))) gaps.push(`${t}: mapped test file is missing`);
    }
  }

  const oq = join(repoDir, 'objective', 'OPEN-QUESTIONS.md');
  if (existsSync(oq)) {
    for (const line of readFileSync(oq, 'utf8').split('\n')) {
      const m = /^\s*[-*] \[ \] (.+)$/.exec(line);
      if (m) gaps.push(`open question unresolved: ${brief(m[1])}`);
    }
  }
  return { ready: gaps.length === 0, gaps };
}
