import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkFormats } from './formats.js';
import { bulletsBySection, lintSpecs } from './spec-lint.js';
import { parseTestPlan } from './test-plan-gate.js';

/** Fine-grained means at least this many atomic, testable requirements per spec. */
export const MIN_REQUIREMENTS = 3;

const NEGATIVE = /\b(throws?|rejects?|errors?|invalid|fails?|refus(?:e|es|ed)|must not|never)\b/i;
const VAGUE = /\b(fast|quick(?:ly)?|slow|secure|robust|user-friendly|easy|easily|simple|intuitive|scalable|efficient(?:ly)?|reliable|performant|flexible|seamless(?:ly)?|modern|clean|good|better|nice|appropriate(?:ly)?|reasonabl[ey]|sufficient(?:ly)?)\b/gi;
const NON_FUNCTIONAL = /\b(latency|throughput|performance|memory|response time|uptime|availability|capacity|rate limits?|concurren(?:t|cy)|scalab\w+|timeouts?|encrypt\w*|retention)\b/i;

/** The ten interview dimensions each spec records as `covered` or `n/a: <reason>` under `## Dimensions`. */
export const DIMENSIONS = [
  'Actors and goals',
  'Behaviour',
  'Inputs and outputs',
  'Failure paths',
  'Edge cases',
  'Interfaces and data',
  'Non-functional',
  'Constraints',
  'Acceptance',
  'Out of scope',
];

const PLACEHOLDER = /\b(TBD|TODO|FIXME)\b|\?\?|<[^>\n]+>/;

/**
 * @param {string} repoDir
 * @returns {boolean} true when the repo was seeded with an objective kit (`hodgepodge init --seed objective`)
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
 * @param {string} s
 */
const brief = (s) => (s.length > 60 ? `${s.slice(0, 57)}...` : s);

/**
 * @param {string} path
 * @param {string[]} bullets bullets of the `## Dimensions` section (undefined section = empty)
 * @returns {string[]} gaps
 */
function checkDimensions(path, bullets) {
  const gaps = [];
  const known = new Map(DIMENSIONS.map((d) => [d.toLowerCase(), d]));
  const seen = new Set();
  for (const b of bullets) {
    const m = /^([^:]+):\s*(.*)$/.exec(b);
    const name = m ? known.get(m[1].trim().toLowerCase()) : undefined;
    if (!m || !name) {
      gaps.push(`${path}: unknown dimension "${brief(m ? m[1].trim() : b)}" (use ${DIMENSIONS.join(', ')})`);
      continue;
    }
    if (seen.has(name)) {
      gaps.push(`${path}: duplicate dimension ${name}`);
      continue;
    }
    seen.add(name);
    const status = m[2].trim();
    if (/^covered$/i.test(status)) continue;
    const na = /^n\/a\s*[:\-]\s*(.*)$/i.exec(status);
    if (na && na[1].trim()) continue;
    gaps.push(na || /^n\/a$/i.test(status) ? `${path}: dimension ${name} is n/a without a reason` : `${path}: dimension ${name} must be "covered" or "n/a: <reason>"`);
  }
  const missing = DIMENSIONS.filter((d) => !seen.has(d));
  if (missing.length > 0) gaps.push(`${path}: dimension not recorded as covered or n/a (add under "## Dimensions"): ${missing.join(', ')}`);
  return gaps;
}

/**
 * Per-dimension state of a spec's `## Dimensions` bullets: `covered`, `n/a` (with a reason),
 * `gap` (recorded but not valid) or `missing` (not recorded).
 * @param {string[]} bullets
 * @returns {Record<string, 'covered' | 'n/a' | 'gap' | 'missing'>}
 */
export function dimensionStates(bullets) {
  /** @type {Record<string, 'covered' | 'n/a' | 'gap' | 'missing'>} */
  const states = Object.fromEntries(DIMENSIONS.map((d) => [d, 'missing']));
  const known = new Map(DIMENSIONS.map((d) => [d.toLowerCase(), d]));
  for (const b of bullets) {
    const m = /^([^:]+):\s*(.*)$/.exec(b);
    const name = m ? known.get(m[1].trim().toLowerCase()) : undefined;
    if (!m || !name || states[name] !== 'missing') continue;
    const status = m[2].trim();
    states[name] = /^covered$/i.test(status) ? 'covered' : /^n\/a\s*[:\-]\s*\S/i.test(status) ? 'n/a' : 'gap';
  }
  return states;
}

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
    for (const r of reqs) {
      const body = stripCode(r.replace(/^R-\S+?-\d+:\s*/, ''));
      const vague = [...new Set((body.match(VAGUE) ?? []).map((w) => w.toLowerCase()))];
      if (vague.length > 0) gaps.push(`${path}: vague word "${vague.join('", "')}" in requirement, give a measurable threshold or concrete behaviour: "${brief(r)}"`);
      if (NON_FUNCTIONAL.test(body) && !/\d/.test(body)) gaps.push(`${path}: non-functional requirement has no measurable threshold (a number and unit): "${brief(r)}"`);
    }
    gaps.push(...checkDimensions(path, sections.get('dimensions') ?? []));
    if (![...reqs, ...examples].some((s) => NEGATIVE.test(s))) gaps.push(`${path}: no failure or negative path in requirements or examples`);
    if (scope.length === 0) gaps.push(`${path}: Out of scope is empty`);
  }

  gaps.push(...checkFormats(repoDir));

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
