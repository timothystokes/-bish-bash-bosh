import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { runTests } from './test-gate.js';
import { checkTypeGate, checkAntiStubGate } from './diff-gates.js';
import { bulletsBySection } from './spec-lint.js';
import { parseTestPlan } from './test-plan-gate.js';

/**
 * @typedef {{id: string, spec: string, implementation: string, status: 'passing' | 'failing' | 'unproven', tests: string[]}} RequirementEvidence
 * @typedef {{ok: boolean, suite: {ok: boolean}, types: {ok: boolean}, requirements: RequirementEvidence[], gaps: string[]}} DoneReport
 */

const GAPS_HEADING = '## Verification gaps';

/**
 * Test name -> passed, from spec-reporter (`✔ name (1ms)`, `✖ name`) or TAP (`ok 1 - name`, `not ok 2 - name`) output.
 * @param {string} output
 * @returns {Map<string, boolean>}
 */
export function testResults(output) {
  /** @type {Map<string, boolean>} */
  const out = new Map();
  for (const line of output.split('\n')) {
    const m = /^\s*([✔✖]) (.+?)(?: \([\d.]+m?s\))?$/u.exec(line);
    if (m) {
      out.set(m[2], m[1] === '✔');
      continue;
    }
    const t = /^\s*(not ok|ok) \d+ - (.+?)(?: # .*)?$/.exec(line);
    if (t) out.set(t[2], t[1] === 'ok');
  }
  return out;
}

/**
 * Requirement IDs (`R-<spec>-<n>:` bullets under `## Requirements`) per spec file.
 * @param {string} repoDir
 * @returns {{id: string, spec: string}[]}
 */
export function requirementsOf(repoDir) {
  const dir = join(repoDir, 'specs');
  if (!existsSync(dir)) return [];
  /** @type {{id: string, spec: string}[]} */
  const out = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
    for (const r of bulletsBySection(readFileSync(join(dir, f), 'utf8')).get('requirements') ?? []) {
      const m = /^(R-[\w.-]+-\d+):\s/.exec(r);
      if (m) out.push({ id: m[1], spec: `specs/${f}` });
    }
  }
  return out;
}

const escapeRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Source files (not tests, specs, docs, data or run records) scanned for stub markers.
 * @param {string} repoDir
 * @returns {string[]}
 */
function sourceFiles(repoDir) {
  const files = execFileSync('git', ['-C', repoDir, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  return files.filter((f) => !/^(tests?|specs|objective|runs|node_modules)\//.test(f) && !/\.(md|json|lock)$/.test(f));
}

/**
 * Harness-derived "done": suite green, types clean, every requirement proven by a passing test whose
 * name contains its ID, every spec with requirements `Implementation: implemented`, no stub markers.
 * @param {string} repoDir
 * @param {{testCommand: string[], typeCommand?: string[]}} opts
 * @returns {{ok: boolean, gaps: string[], report: DoneReport}}
 */
export function verifyDone(repoDir, { testCommand, typeCommand }) {
  /** @type {string[]} */
  const gaps = [];
  const suite = runTests(testCommand, repoDir);
  const suiteOk = suite.exitStatus === 0;
  if (!suiteOk) gaps.push(`suite is not green (exit ${suite.exitStatus})`);
  const types = checkTypeGate(repoDir, typeCommand);
  if (!types.ok) gaps.push(types.reason ?? 'type check failed');

  const results = testResults(suite.output);
  const reqs = requirementsOf(repoDir);
  /** @type {RequirementEvidence[]} */
  const requirements = reqs.map(({ id, spec }) => {
    const re = new RegExp(`(?<![\\w-])${escapeRe(id)}(?![\\w-])`);
    const named = [...results].filter(([name]) => re.test(name));
    const passing = named.filter(([, ok]) => ok).map(([n]) => n);
    const failing = named.some(([, ok]) => !ok);
    const status = failing ? 'failing' : passing.length > 0 ? 'passing' : 'unproven';
    if (status !== 'passing') gaps.push(`${id}: no passing test names it${failing ? ' (a test naming it fails)' : ''}`);
    return { id, spec, implementation: 'none', status, tests: passing };
  });
  for (const spec of new Set(reqs.map((r) => r.spec))) {
    const own = requirements.filter((r) => r.spec === spec);
    const impl = own.every((r) => r.status === 'passing') ? 'implemented' : own.some((r) => r.status === 'passing') ? 'partial' : 'none';
    for (const r of own) r.implementation = impl;
  }

  const diff = sourceFiles(repoDir)
    .flatMap((f) => [`+++ b/${f}`, ...readFileSync(join(repoDir, f), 'utf8').split('\n').map((l) => `+${l}`)])
    .join('\n');
  const stubs = checkAntiStubGate(diff);
  if (!stubs.ok) gaps.push(`stubs: ${stubs.reason}`);

  return { ok: gaps.length === 0, gaps, report: { ok: gaps.length === 0, suite: { ok: suiteOk }, types: { ok: types.ok }, requirements, gaps } };
}

/**
 * Rewrite the `## Verification gaps` section of plan.md as unchecked items (none: remove it),
 * so an agent-ticked plan that verification disproves is not done.
 * @param {string} plan
 * @param {string[]} gaps
 * @returns {string}
 */
export function applyGaps(plan, gaps) {
  const lines = plan.split('\n');
  const start = lines.indexOf(GAPS_HEADING);
  if (start !== -1) {
    let end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
    if (end === -1) end = lines.length;
    lines.splice(start, end - start);
  }
  const base = lines.join('\n').replace(/\n+$/, '\n');
  if (gaps.length === 0) return base;
  return `${base}\n${GAPS_HEADING}\n${gaps.map((g) => `- [ ] Verify: ${g}`).join('\n')}\n`;
}

/**
 * Harness-owned `Implementation:` and `Evidence:` of each spec, derived from the evidence: `implemented` when every
 * requirement has a passing test, `partial` when some do, else `none`. Evidence is the tests/PLAN.md mapping that exists.
 * The build agent cannot write `specs/`, so a self-declared status never decides "done".
 * @param {string} repoDir
 * @param {RequirementEvidence[]} requirements
 * @returns {string[]} spec paths that were rewritten
 */
export function syncImplementation(repoDir, requirements) {
  const planPath = join(repoDir, 'tests', 'PLAN.md');
  const mapped = existsSync(planPath) ? parseTestPlan(readFileSync(planPath, 'utf8')) : new Map();
  /** @type {string[]} */
  const changed = [];
  for (const spec of new Set(requirements.map((r) => r.spec))) {
    const own = requirements.filter((r) => r.spec === spec);
    const impl = own[0].implementation;
    const evidence = [...new Set([spec, ...own.map((r) => r.id)].flatMap((k) => mapped.get(k) ?? []))].filter((p) => existsSync(join(repoDir, p)));
    const path = join(repoDir, spec);
    const text = readFileSync(path, 'utf8');
    const lines = text.split('\n').filter((l) => !/^(Implementation|Evidence):/.test(l));
    const head = lines.findIndex((l) => /^# /.test(l));
    const fields = [`Implementation: ${impl}`, ...(impl === 'none' || evidence.length === 0 ? [] : [`Evidence: ${evidence.join(', ')}`])];
    lines.splice(head + 1, 0, ...fields);
    const next = lines.join('\n');
    if (next !== text) {
      writeFileSync(path, next);
      changed.push(spec);
    }
  }
  return changed;
}

/**
 * @param {string} repoDir
 * @param {string} runId
 * @param {DoneReport} report
 */
export function writeDoneReport(repoDir, runId, report) {
  const path = join(repoDir, 'runs', runId, 'done.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}
