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
 * Bullets under each `## Heading` (outside code fences), keyed by lower-cased heading.
 * @param {string} text
 * @returns {Map<string, string[]>}
 */
export function bulletsBySection(text) {
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
 * Value of the first `Name: value` line outside code fences.
 * @param {string} text
 * @param {string} name
 * @returns {string | null}
 */
function field(text, name) {
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && line.startsWith(`${name}:`)) return line.slice(name.length + 1).trim();
  }
  return null;
}

/**
 * Deterministic structure check of `specs/*.md`: non-empty, one `# Spec: ...` title
 * (one decision per file), unique titles, an `Implementation: none|partial|implemented` field (with existing
 * `Evidence:` paths unless `none`), requirement IDs `R-<spec>-<n>` that are unique, and every spec and
 * requirement mapped to a test in `tests/PLAN.md`.
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
  /** @type {Set<string>} */
  const ids = new Set();
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

    const impl = field(text, 'Implementation');
    if (impl === null || !/^(none|partial|implemented)$/.test(impl)) {
      problems.push(`${path}: needs "Implementation: none|partial|implemented"${impl === null ? '' : `, found "${impl}"`}`);
    } else if (impl !== 'none') {
      const paths = (field(text, 'Evidence') ?? '').split(',').map((p) => p.trim().replace(/^`|`$/g, '')).filter(Boolean);
      if (paths.length === 0) problems.push(`${path}: Implementation: ${impl} needs "Evidence:" links (code, tests)`);
      for (const p of paths) if (!existsSync(join(repoDir, p))) problems.push(`${path}: evidence file missing: ${p}`);
    }

    const base = f.slice(0, -'.md'.length);
    const idRe = new RegExp(`^R-${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+):\\s`);
    for (const r of bulletsBySection(text).get('requirements') ?? []) {
      const m = idRe.exec(r);
      if (!m) {
        problems.push(`${path}: requirement must start with "R-${base}-<n>:": "${r.length > 60 ? `${r.slice(0, 57)}...` : r}"`);
        continue;
      }
      const id = `R-${base}-${m[1]}`;
      if (ids.has(id)) problems.push(`${path}: duplicate requirement ID ${id}`);
      ids.add(id);
    }
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
    for (const id of [...ids].sort()) {
      if ((mapped.get(id) ?? []).length === 0) problems.push(`${id}: requirement not mapped to a test in tests/PLAN.md`);
    }
    for (const key of [...mapped.keys()].sort()) {
      if (key.startsWith('R-') && !ids.has(key)) problems.push(`${key}: tests/PLAN.md maps a requirement that no spec declares`);
    }
  }
  return { ok: problems.length === 0, problems };
}
