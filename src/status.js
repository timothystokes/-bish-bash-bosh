import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sumRunUsage } from './budget-gate.js';

/**
 * @typedef {import('./budget-gate.js').RunTotals} RunTotals
 * @typedef {import('./budget-gate.js').Budgets} Budgets
 * @typedef {{
 *   totals(runId: string): RunTotals,
 *   lastStatus(runId: string): string | null,
 *   tail(runId: string, lines: number): string[],
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
 * @param {string} repoDir
 * @param {string} runId
 * @returns {string | null} directory of the newest complete iteration record
 */
function lastIteration(repoDir, runId) {
  const base = join(repoDir, 'runs', runId, 'iterations');
  if (!existsSync(base)) return null;
  const last = readdirSync(base)
    .filter((n) => /^\d+$/.test(n) && existsSync(join(base, n, 'record.json')))
    .sort()
    .pop();
  return last ? join(base, last) : null;
}

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
      const last = lastIteration(repoDir, runId);
      return last ? JSON.parse(readFileSync(join(last, 'record.json'), 'utf8')).status : null;
    },
    tail(runId, lines) {
      const last = lastIteration(repoDir, runId);
      if (!last || !existsSync(join(last, 'transcript'))) return [];
      return readFileSync(join(last, 'transcript'), 'utf8').replace(/\n$/, '').split('\n').slice(-lines);
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
