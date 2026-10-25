import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sumRunUsage } from './budget-gate.js';

/**
 * @typedef {import('./budget-gate.js').RunTotals} RunTotals
 * @typedef {import('./budget-gate.js').Budgets} Budgets
 * @typedef {{
 *   totals(runId: string): RunTotals,
 *   lastStatus(runId: string): string | null,
 * }} StatusSource
 * @typedef {{
 *   runId: string,
 *   iterations: number,
 *   lastStatus: string | null,
 *   totals: RunTotals,
 *   budgets: Budgets,
 *   remaining: RunTotals,
 * }} RunStatus
 */

/**
 * Status source backed by local run files (`runs/<id>/iterations/NNN`).
 * Other sources (e.g. cloud execution history) implement the same interface.
 * @param {string} repoDir
 * @returns {StatusSource}
 */
export function createLocalStatusSource(repoDir) {
  return {
    totals: (runId) => sumRunUsage(repoDir, runId),
    lastStatus(runId) {
      const base = join(repoDir, 'runs', runId, 'iterations');
      if (!existsSync(base)) return null;
      const last = readdirSync(base)
        .filter((n) => /^\d+$/.test(n) && existsSync(join(base, n, 'record.json')))
        .sort()
        .pop();
      return last ? JSON.parse(readFileSync(join(base, last, 'record.json'), 'utf8')).status : null;
    },
  };
}

/**
 * @param {StatusSource} source
 * @param {string} runId
 * @param {Budgets} budgets
 * @returns {RunStatus}
 */
export function readRunStatus(source, runId, budgets) {
  const totals = source.totals(runId);
  return {
    runId,
    iterations: totals.iterations,
    lastStatus: source.lastStatus(runId),
    totals,
    budgets,
    remaining: {
      tokens: budgets.maxTokens - totals.tokens,
      cost: budgets.maxCostUsd - totals.cost,
      seconds: budgets.maxWallClockSeconds - totals.seconds,
      iterations: budgets.maxIterations - totals.iterations,
    },
  };
}
