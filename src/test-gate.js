import { spawnSync } from 'node:child_process';

/** @typedef {{ok: boolean, exitStatus: number, output: string, detail?: string}} TestGateResult */

// Steps that only touch these paths change no behaviour, so there is nothing to regress.
const PLANNING_PATHS = ['plan.md', 'tests/PLAN.md', 'specs/'];

/**
 * @param {string[]} changed repo-relative paths staged by the step
 * @returns {boolean}
 */
export function isPlanningOnly(changed) {
  return changed.length > 0 && changed.every((f) => PLANNING_PATHS.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)));
}

/**
 * Names of failing tests in spec-reporter (`✖ name (1ms)`) or TAP (`not ok 1 - name`) output.
 * @param {string} output
 * @returns {Set<string>}
 */
export function failingTests(output) {
  const names = new Set();
  for (const line of output.split('\n')) {
    const m = /^\s*✖ (.+?)(?: \([\d.]+m?s\))?$/.exec(line) ?? /^\s*not ok \d+ - (.+?)(?: # .*)?$/.exec(line);
    if (m && m[1] !== 'failing tests:') names.add(m[1]);
  }
  return names;
}

/**
 * @param {string[]} command
 * @param {string} cwd
 */
export function runTests(command, cwd) {
  const [cmd, ...args] = command;
  const t = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  const output = `${t.stdout ?? ''}${t.stderr ?? ''}`;
  return { exitStatus: t.status ?? 1, output };
}

/**
 * Regression gate: green, or red only with failures that were already failing before the step.
 * @param {{exitStatus: number, output: string}} after
 * @param {{exitStatus: number, output: string}} before suite run at HEAD before the agent ran
 * @returns {TestGateResult}
 */
export function checkTestsNoRegression(after, before) {
  if (after.exitStatus === 0) return { ok: true, exitStatus: 0, output: after.output };
  const failing = failingTests(after.output);
  const known = before.exitStatus === 0 ? new Set() : failingTests(before.output);
  const fresh = [...failing].filter((n) => !known.has(n));
  if (failing.size === 0) return { ok: false, exitStatus: after.exitStatus, output: after.output, detail: 'failed' };
  if (fresh.length > 0) return { ok: false, exitStatus: after.exitStatus, output: after.output, detail: `newly failing: ${fresh.join(', ')}` };
  return { ok: true, exitStatus: after.exitStatus, output: after.output, detail: `no regression (${failing.size} still failing from before)` };
}
