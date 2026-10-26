import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runStep } from './step.js';
import { verifyDone, applyGaps, syncImplementation, requirementsOf, writeDoneReport } from './done.js';
import { lintSpecs } from './spec-lint.js';
import { checkReadiness, hasObjectiveKit } from './readiness.js';
import { runQaCycle, qaCycles, DEFAULT_MAX_QA_CYCLES } from './qa.js';
import { readControl, consumeSteer } from './control.js';

/**
 * @typedef {import('./step.js').StepResult} StepResult
 * @typedef {import('./qa.js').QaResult} QaResult
 * @typedef {{status: 'done' | 'over-budget' | 'failed' | 'gated' | 'stopped', steps: StepResult[], reason?: string, qa?: QaResult[]}} LoopResult
 */

/**
 * A plan is done when it has at least one checkbox item and none are unchecked.
 * @param {string} plan
 * @returns {boolean}
 */
export function isPlanDone(plan) {
  const items = plan.match(/^\s*[-*] \[[ xX]\]/gm) ?? [];
  return items.length > 0 && !/^\s*[-*] \[ \]/m.test(plan);
}

/**
 * Local driver: loops `runStep` until the plan is done or a step is not ok.
 * Failures stop the loop (tune prompts/specs/gates; no blind retries).
 * With `controlFile`, `control.json` is read before every iteration: stop ends the loop,
 * paused waits (polling), a steer note goes into the next prompt only.
 * With `qaAdapter` (the `qa` role), a verified plan is done only after an independent QA cycle reports no findings; findings
 * become plan items for the build agent and QA re-checks, up to config `maxQaCycles` (default 5).
 * @param {Parameters<typeof runStep>[0] & {controlFile?: string, qaAdapter?: import('./adapter.js').Adapter, sleep?: (ms: number) => Promise<void>, pollMs?: number}} opts
 * @returns {Promise<LoopResult>}
 */
export async function runLoop(opts) {
  const { controlFile, qaAdapter, pollMs = 1000, sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms)), ...stepOpts } = opts;
  if (hasObjectiveKit(stepOpts.repoDir)) {
    const ready = checkReadiness(stepOpts.repoDir);
    if (!ready.ready) return { status: 'gated', steps: [], reason: `objective not ready (run \`hodgepodge ready\`): ${ready.gaps.join('; ')}` };
  }
  if (stepOpts.requireTestPlan) {
    // Before the plan step has written tests/PLAN.md only the specs' structure can be checked.
    const lint = lintSpecs(stepOpts.repoDir, { testPlan: existsSync(join(stepOpts.repoDir, 'tests', 'PLAN.md')) });
    if (!lint.ok) return { status: 'gated', steps: [], reason: `spec-lint failed: ${lint.problems.join('; ')}` };
  }
  /** @type {StepResult[]} */
  const steps = [];
  /** @type {QaResult[]} */
  const qa = [];
  const withQa = (/** @type {LoopResult} */ r) => (qa.length > 0 ? { ...r, qa } : r);
  const startPlan = join(stepOpts.repoDir, 'plan.md');
  const startConflict = existsSync(startPlan) ? findConflict(readFileSync(startPlan, 'utf8')) : undefined;
  if (startConflict) return { status: 'gated', steps, reason: `unresolved ${startConflict}: fix the spec or tests (\`hodge\`), then resolve it in plan.md` };
  for (;;) {
    /** @type {string | undefined} */
    let steer;
    if (controlFile) {
      let ctl = readControl(controlFile);
      while (ctl.ok && ctl.paused && !ctl.stop) {
        await sleep(pollMs);
        ctl = readControl(controlFile);
      }
      if (!ctl.ok) return { status: 'stopped', steps, reason: ctl.reason };
      if (ctl.stop) return { status: 'stopped', steps, reason: 'stop requested via control file' };
      steer = ctl.steer;
    }
    const res = await runStep({ ...stepOpts, ...(steer ? { steer } : {}) });
    if (controlFile && steer) consumeSteer(controlFile, steer);
    steps.push(res);
    if (res.status !== 'ok') return withQa({ status: res.status, steps, ...(res.reason ? { reason: res.reason } : {}) });
    const planPath = join(stepOpts.repoDir, 'plan.md');
    const plan = existsSync(planPath) ? readFileSync(planPath, 'utf8') : '';
    const conflict = findConflict(plan);
    if (conflict) return { status: 'gated', steps, reason: `unresolved ${conflict}: fix the spec or tests (\`hodge\`), then resolve it in plan.md` };
    if (isPlanDone(plan)) {
      const unproven = verifyPlanDone(stepOpts, plan);
      if (!unproven) {
        if (!qaAdapter) return { status: 'done', steps };
        const max = /** @type {{maxQaCycles?: number}} */ (stepOpts.config).maxQaCycles ?? DEFAULT_MAX_QA_CYCLES;
        if (qaCycles(stepOpts.repoDir, stepOpts.runId) >= max) {
          return withQa({ status: 'failed', steps, reason: `qa cycle limit (${max}) reached: the last findings were not re-verified` });
        }
        const q = await runQaCycle({ config: stepOpts.config, repoDir: stepOpts.repoDir, runId: stepOpts.runId, adapter: qaAdapter, identity: stepOpts.identity });
        qa.push(q);
        if (q.status === 'clean') return withQa({ status: 'done', steps });
        if (q.status !== 'findings') return withQa({ status: q.status, steps, reason: `qa ${q.status}: ${q.reason ?? ''}`.trim() });
      }
    }
  }
}

/**
 * When specs declare requirement IDs, a ticked plan is only done if `verifyDone` agrees; otherwise
 * the plan gets unchecked verification items (committed) and the loop continues.
 * @param {{repoDir: string, runId: string, testCommand?: string[], typeCommand?: string[]}} o
 * @param {string} plan
 * @returns {boolean} true when verification disproved the plan
 */
function verifyPlanDone({ repoDir, runId, testCommand = ['npm', 'test'], typeCommand }, plan) {
  if (requirementsOf(repoDir).length === 0) return false;
  const v = verifyDone(repoDir, { testCommand, typeCommand });
  syncImplementation(repoDir, v.report.requirements);
  writeDoneReport(repoDir, runId, v.report);
  if (!v.ok) writeFileSync(join(repoDir, 'plan.md'), applyGaps(plan, v.gaps));
  const git = (/** @type {string[]} */ ...a) => execFileSync('git', ['-C', repoDir, ...a], { encoding: 'utf8' });
  git('add', '-A');
  if (git('status', '--porcelain').trim() !== '') git('commit', '-q', '-m', `podge verify ${runId}: ${v.ok ? 'done' : 'gaps'}`);
  return !v.ok;
}

/**
 * First unchecked plan item the agent marked as a spec/test conflict.
 * @param {string} plan
 * @returns {string | undefined}
 */
export function findConflict(plan) {
  return plan.match(/^\s*[-*] \[ \] (CONFLICT:.*)$/m)?.[1]?.slice(0, 200);
}
