import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{tokens: number, cost: number, seconds: number, iterations: number}} RunTotals
 * @typedef {{maxTokens: number, maxCostUsd: number, maxWallClockSeconds: number, maxIterations: number}} Budgets
 */

/**
 * Sum usage over a run's iteration records (`runs/<runId>/iterations/NNN/usage.json`)
 * plus its interview record (`runs/<runId>/interview/record.json`, not an iteration).
 * @param {string} repoDir
 * @param {string} runId
 * @returns {RunTotals}
 */
export function sumRunUsage(repoDir, runId) {
  const totals = { tokens: 0, cost: 0, seconds: 0, iterations: 0 };
  const interview = join(repoDir, 'runs', runId, 'interview', 'record.json');
  if (existsSync(interview)) {
    const u = JSON.parse(readFileSync(interview, 'utf8')).usage ?? {};
    totals.tokens += u.tokens ?? 0;
    totals.cost += u.cost ?? 0;
    totals.seconds += u.seconds ?? 0;
  }
  const base = join(repoDir, 'runs', runId, 'iterations');
  if (!existsSync(base)) return totals;
  for (const n of readdirSync(base)) {
    const file = join(base, n, 'usage.json');
    if (!/^\d+$/.test(n) || !existsSync(file)) continue;
    const u = JSON.parse(readFileSync(file, 'utf8'));
    totals.tokens += u.tokens ?? 0;
    totals.cost += u.cost ?? 0;
    totals.seconds += u.seconds ?? 0;
    totals.iterations += 1;
  }
  return totals;
}

/**
 * Refuse another step once any run-wide cap is exhausted.
 * @param {string} repoDir
 * @param {string} runId
 * @param {Budgets} budgets
 * @returns {{ok: boolean, reason?: string, totals: RunTotals, remaining: Omit<RunTotals, never>}}
 */
export function checkBudgetGate(repoDir, runId, budgets) {
  const totals = sumRunUsage(repoDir, runId);
  const remaining = {
    tokens: budgets.maxTokens - totals.tokens,
    cost: budgets.maxCostUsd - totals.cost,
    seconds: budgets.maxWallClockSeconds - totals.seconds,
    iterations: budgets.maxIterations - totals.iterations,
  };
  const exhausted = [
    [remaining.iterations, 'iteration cap reached'],
    [remaining.tokens, 'tokens budget exhausted'],
    [remaining.cost, 'cost budget exhausted'],
    [remaining.seconds, 'wall-clock budget exhausted'],
  ].find(([left]) => /** @type {number} */ (left) <= 0);
  return exhausted
    ? { ok: false, reason: `${exhausted[1]} for run ${runId}`, totals, remaining }
    : { ok: true, totals, remaining };
}
