import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readControl } from './control.js';
import { isPlanDone } from './podge-driver.js';
import { createLocalStatusSource } from './status.js';

function headSha(repoDir) {
  try {
    return execFileSync('git', ['-C', repoDir, 'rev-parse', '--verify', '-q', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// Rebuilds the execution-context pointers from git and run records only (the payload of the
// state machine's `ReadPointers` lambda). Status is `done` when the plan is fully ticked,
// else the last iteration's status, else `new`. A malformed control file fails closed as stop.
export function rebuildPointers(repoDir, runId, controlFile) {
  const source = createLocalStatusSource(repoDir);
  const totals = source.totals(runId);
  const ctl = readControl(controlFile);
  const planPath = join(repoDir, 'plan.md');
  const planDone = existsSync(planPath) && isPlanDone(readFileSync(planPath, 'utf8'));
  return {
    sha: headSha(repoDir),
    iteration: totals.iterations,
    status: planDone ? 'done' : (source.lastStatus(runId) ?? 'new'),
    paused: ctl.ok ? ctl.paused : false,
    stop: ctl.ok ? ctl.stop : true,
  };
}
