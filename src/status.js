import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sumRunUsage } from './budget-gate.js';
import { readRunDetails } from './run-details.js';

function lastIteration(repoDir, runId) {
  const base = join(repoDir, '.hodgepodge', 'runs', runId, 'iterations');
  if (!existsSync(base)) return null;
  const last = readdirSync(base)
    .filter((n) => /^\d+$/.test(n) && existsSync(join(base, n, 'record.json')))
    .sort()
    .pop();
  return last ? join(base, last) : null;
}

// Status source backed by local run files (`runs/<id>/iterations/NNN`).
// Other sources (e.g. cloud execution history) implement the same interface.
export function createLocalStatusSource(repoDir) {
  return {
    totals: (runId) => sumRunUsage(repoDir, runId),
    lastStatus(runId) {
      const last = lastIteration(repoDir, runId);
      return last ? JSON.parse(readFileSync(join(last, 'record.json'), 'utf8')).status : null;
    },
    details: (runId) => readRunDetails(repoDir, runId),
    tail(runId, lines) {
      const last = lastIteration(repoDir, runId);
      if (!last || !existsSync(join(last, 'transcript'))) return [];
      return readFileSync(join(last, 'transcript'), 'utf8').replace(/\n$/, '').split('\n').slice(-lines);
    },
  };
}

export function readRunStatus(source, runId, budgets) {
  const totals = source.totals(runId);
  return {
    runId,
    iterations: totals.iterations,
    lastStatus: source.lastStatus(runId),
    totals,
    budgets,
    details: source.details(runId),
    remaining: {
      seconds: budgets.maxWallClockSeconds - totals.seconds,
      iterations: budgets.maxIterations - totals.iterations,
    },
  };
}
