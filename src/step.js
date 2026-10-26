import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateConfig } from './config.js';
import { checkAntiStubGate, checkScopeGate, checkTypeGate } from './diff-gates.js';
import { checkBudgetGate } from './budget-gate.js';
import { checkTestPlanGate } from './test-plan-gate.js';
import { checkRepoGate, harnessIdentity } from './repo-gate.js';
import { writeIterationRecord } from './run-record.js';
import { loadModePrompt } from './prompts.js';
import { checkBrownfieldGate } from './brownfield-gate.js';
import { checkHardeningGate } from './hardening-gate.js';
import { checkCleanRoomGate } from './clean-room.js';

/**
 * @typedef {import('./adapter.js').Adapter} Adapter
 * @typedef {import('./repo-gate.js').HarnessIdentity} HarnessIdentity
 * @typedef {{sha: string | null, iteration: number, cost: number, status: 'ok' | 'failed' | 'gated' | 'over-budget', reason?: string}} StepResult
 */

/** @param {string} p */
const readIfExists = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

/**
 * Fixed per-iteration context stack: loop prompt + specs index + plan.md.
 * @param {string} repoDir
 * @param {string} [mode]
 * @param {string} [steer] operator note for this iteration only
 * @returns {string}
 */
export function buildPrompt(repoDir, mode = 'forward', steer) {
  const specsDir = join(repoDir, 'specs');
  const specs = existsSync(specsDir)
    ? readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort()
    : [];
  const index = specs.map((f) => {
    const title = readFileSync(join(specsDir, f), 'utf8').split('\n')[0];
    return `- specs/${f}: ${title}`;
  });
  return [
    loadModePrompt(mode),
    '## Specs index',
    index.join('\n'),
    '## plan.md',
    readIfExists(join(repoDir, 'plan.md')),
    ...(steer ? ['## Steer note', steer] : []),
  ].join('\n\n');
}

/**
 * @param {string} dir
 * @param {string[]} args
 */
const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

/** @param {string} dir */
function nextIteration(dir, /** @type {string} */ runId) {
  const base = join(dir, 'runs', runId, 'iterations');
  if (!existsSync(base)) return 1;
  const nums = readdirSync(base).filter((n) => /^\d+$/.test(n)).map(Number);
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
}

/**
 * One idempotent loop iteration: gates, agent call, scoped tests, commit, run record.
 * @param {{
 *   config: unknown,
 *   repoDir: string,
 *   runId: string,
 *   adapter: Adapter,
 *   testCommand?: string[],
 *   typeCommand?: string[],
 *   requireTestPlan?: boolean,
 *   steer?: string,
 *   identity?: HarnessIdentity,
 * }} opts
 * @returns {Promise<StepResult>}
 */
export async function runStep({ config, repoDir, runId, adapter, testCommand = ['npm', 'test'], typeCommand, requireTestPlan = false, steer, identity }) {
  const v = validateConfig(config);
  if (!v.ok) throw new Error(`invalid config: ${v.errors.join('; ')}`);
  const cfg = /** @type {{targetRepo: string, budgets: import('./budget-gate.js').Budgets, allowedPaths: string[], mode?: string, hardenCommand?: string[]}} */ (config);

  const self = identity ?? harnessIdentity();
  const gated = (/** @type {string} */ reason) => ({ sha: null, iteration: 0, cost: 0, status: /** @type {const} */ ('gated'), reason });
  for (const target of [cfg.targetRepo, repoDir]) {
    const g = checkRepoGate(target, self);
    if (!g.ok) return gated(g.reason);
  }
  if (git(repoDir, 'status', '--porcelain').trim() !== '') {
    return gated('working tree is not clean');
  }

  if (cfg.mode === 'brownfield') {
    const bf = checkBrownfieldGate(repoDir);
    if (!bf.ok) return gated(bf.reason ?? 'brownfield gate failed');
  }

  if (cfg.mode === 'clean-room') {
    const cr = checkCleanRoomGate(repoDir);
    if (!cr.ok) return gated(cr.reason ?? 'clean-room firewall failed');
  }

  const hardening = cfg.mode === 'test-hardening';
  if (hardening && !(cfg.hardenCommand && cfg.hardenCommand.length > 0)) {
    return gated(checkHardeningGate(repoDir, undefined).reason ?? 'hardening gate failed');
  }

  const budget = checkBudgetGate(repoDir, runId, cfg.budgets);
  if (!budget.ok) {
    return { sha: null, iteration: 0, cost: 0, status: 'over-budget', reason: budget.reason };
  }

  const iteration = nextIteration(repoDir, runId);
  if (requireTestPlan) {
    const plan = checkTestPlanGate(repoDir, { testCommand, requireRed: iteration === 1 });
    if (!plan.ok) return gated(plan.reason ?? 'test-plan gate failed');
  }
  const prompt = buildPrompt(repoDir, cfg.mode, steer);
  const maxTokens = budget.remaining.tokens;
  const maxCostUsd = budget.remaining.cost;
  const maxWallClockSeconds = Math.min(cfg.budgets.maxWallClockSeconds, budget.remaining.seconds);
  const started = Date.now();
  const result = await adapter.run({
    prompt,
    cwd: repoDir,
    limits: { maxTokens, maxCostUsd, maxWallClockSeconds },
  });
  const seconds = (Date.now() - started) / 1000;

  git(repoDir, 'add', '-A');
  const diff = git(repoDir, 'diff', '--cached');

  /** @type {StepResult['status']} */
  let status = 'ok';
  /** @type {unknown} */
  let test = { skipped: true };
  const overBudget = result.usage.tokens > maxTokens || result.usage.cost > maxCostUsd;
  /** @type {{name: string, ok: boolean, detail?: string}[]} */
  const gates = [{ name: 'repo', ok: true }, { name: 'budget', ok: true }];
  if (requireTestPlan) gates.push({ name: 'test-plan', ok: true });
  const preGates = gates.length;
  /** @param {string} name @param {import('./diff-gates.js').GateCheck} c */
  const record = (name, c) => {
    gates.push({ name, ok: c.ok, detail: c.ok ? c.detail : c.reason });
    return c.ok;
  };
  if (result.exitStatus !== 0) {
    status = overBudget ? 'over-budget' : 'failed';
  } else {
    const staged = git(repoDir, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
    const diffOk = [
      record('scope', checkScopeGate(staged, cfg.allowedPaths)),
      record('anti-stub', checkAntiStubGate(diff)),
      ...(hardening ? [record('tests-only', checkScopeGate(staged, ['tests/']))] : []),
    ].every(Boolean);
    if (!diffOk) {
      status = 'failed';
    } else {
      const [cmd, ...args] = testCommand;
      const t = spawnSync(cmd, args, { cwd: repoDir, encoding: 'utf8' });
      test = { exitStatus: t.status ?? 1, output: `${t.stdout ?? ''}${t.stderr ?? ''}` };
      const testsOk = t.status === 0;
      gates.push({ name: 'tests', ok: testsOk, detail: testsOk ? undefined : 'failed' });
      const typesOk = record('types', checkTypeGate(repoDir, typeCommand));
      const hardenOk = !hardening || !testsOk || record('hardening', checkHardeningGate(repoDir, cfg.hardenCommand));
      if (!testsOk || !typesOk || !hardenOk) status = 'failed';
    }
  }

  if (status !== 'ok') {
    // The tree was clean at start, so resetting discards only the agent's work (kept in diff).
    git(repoDir, 'reset', '-q', '--hard', 'HEAD');
    git(repoDir, 'clean', '-fdq');
  }

  writeIterationRecord(repoDir, runId, iteration, {
    status,
    usage: { ...result.usage, seconds },
    changedFiles: result.changedFiles,
    gates: status === 'ok' || gates.length > preGates ? gates : [...gates, { name: 'tests', ok: false, detail: status }],
    prompt,
    transcript: result.transcript,
    diff,
    test,
  });
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', `podge step ${runId}/${String(iteration).padStart(3, '0')}: ${status}`);

  return { sha: git(repoDir, 'rev-parse', 'HEAD').trim(), iteration, cost: result.usage.cost, status };
}
