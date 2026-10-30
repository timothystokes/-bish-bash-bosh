import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Sum wall-clock seconds and iteration counts over a run's iteration records (`runs/<runId>/iterations/NNN/usage.json`)
// plus its interview and QA records (`runs/<runId>/interview[-N]/record.json`, `runs/<runId>/qa-N/record.json`: not iterations).
export function sumRunUsage(repoDir, runId) {
  const totals = { seconds: 0, iterations: 0 };
  const runDir = join(repoDir, '.hodgepodge', 'runs', runId);
  for (const d of existsSync(runDir) ? readdirSync(runDir) : []) {
    const interview = join(runDir, d, 'record.json');
    if (!/^(interview|qa)(-\d+)?$/.test(d) || !existsSync(interview)) continue;
    const u = JSON.parse(readFileSync(interview, 'utf8')).usage ?? {};
    totals.seconds += u.seconds ?? 0;
  }
  const base = join(repoDir, '.hodgepodge', 'runs', runId, 'iterations');
  if (!existsSync(base)) return totals;
  for (const n of readdirSync(base)) {
    const file = join(base, n, 'usage.json');
    if (!/^\d+$/.test(n) || !existsSync(file)) continue;
    const u = JSON.parse(readFileSync(file, 'utf8'));
    totals.seconds += u.seconds ?? 0;
    totals.iterations += 1;
  }
  return totals;
}
