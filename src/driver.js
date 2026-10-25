import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runStep } from './step.js';
import { lintSpecs } from './spec-lint.js';

/**
 * @typedef {import('./step.js').StepResult} StepResult
 * @typedef {{status: 'done' | 'over-budget' | 'failed' | 'gated', steps: StepResult[], reason?: string}} LoopResult
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
 * @param {Parameters<typeof runStep>[0]} opts
 * @returns {Promise<LoopResult>}
 */
export async function runLoop(opts) {
  if (opts.requireTestPlan) {
    const lint = lintSpecs(opts.repoDir);
    if (!lint.ok) return { status: 'gated', steps: [], reason: `spec-lint failed: ${lint.problems.join('; ')}` };
  }
  /** @type {StepResult[]} */
  const steps = [];
  for (;;) {
    const res = await runStep(opts);
    steps.push(res);
    if (res.status !== 'ok') return { status: res.status, steps, ...(res.reason ? { reason: res.reason } : {}) };
    const planPath = join(opts.repoDir, 'plan.md');
    if (existsSync(planPath) && isPlanDone(readFileSync(planPath, 'utf8'))) return { status: 'done', steps };
  }
}
