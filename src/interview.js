import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './config.js';
import { checkBudgetGate } from './budget-gate.js';
import { checkRepoGate, harnessIdentity } from './repo-gate.js';
import { lintSpecs } from './spec-lint.js';
import { loadModePrompt } from './prompts.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

/** Interview may only write specs and the tests that prove them. */
const ALLOWED = ['specs/', 'tests/'];

/**
 * @typedef {{status: 'ok' | 'failed' | 'gated' | 'over-budget', sha: string | null, reason?: string}} InterviewResult
 */

/**
 * @param {string} repoDir
 * @param {string} objective
 * @returns {string}
 */
export function buildInterviewPrompt(repoDir, objective) {
  const specsDir = join(repoDir, 'specs');
  const existing = existsSync(specsDir) ? readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort() : [];
  return [
    loadModePrompt('interview'),
    '## Objective',
    objective.trim(),
    '## Existing specs',
    existing.length === 0 ? '(none)' : existing.map((f) => `- specs/${f}`).join('\n'),
    '## Spec template (templates/spec.md)',
    readFileSync(join(templatesDir, 'spec.md'), 'utf8').trimEnd(),
    '## Test-plan template (templates/tests-PLAN.md)',
    readFileSync(join(templatesDir, 'tests-PLAN.md'), 'utf8').trimEnd(),
  ].join('\n\n');
}

/**
 * @param {string} dir
 * @param {string[]} args
 */
const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

/**
 * Interview mode: one adapter call that writes specs/ and tests/, accepted only if spec-lint passes.
 * @param {{
 *   config: unknown,
 *   repoDir: string,
 *   runId: string,
 *   adapter: import('./adapter.js').Adapter,
 *   objective: string,
 *   identity?: import('./repo-gate.js').HarnessIdentity,
 * }} opts
 * @returns {Promise<InterviewResult>}
 */
export async function runInterview({ config, repoDir, runId, adapter, objective, identity }) {
  const v = validateConfig(config);
  if (!v.ok) throw new Error(`invalid config: ${v.errors.join('; ')}`);
  const cfg = /** @type {{targetRepo: string, budgets: import('./budget-gate.js').Budgets}} */ (config);
  const gated = (/** @type {string} */ reason) => ({ status: /** @type {const} */ ('gated'), sha: null, reason });

  if (objective.trim() === '') return gated('objective is empty');
  const self = identity ?? harnessIdentity();
  for (const target of [cfg.targetRepo, repoDir]) {
    const g = checkRepoGate(target, self);
    if (!g.ok) return gated(g.reason);
  }
  if (git(repoDir, 'status', '--porcelain').trim() !== '') return gated('working tree is not clean');
  const budget = checkBudgetGate(repoDir, runId, cfg.budgets);
  if (!budget.ok) return { status: 'over-budget', sha: null, reason: budget.reason };

  const prompt = buildInterviewPrompt(repoDir, objective);
  const limits = {
    maxTokens: budget.remaining.tokens,
    maxCostUsd: budget.remaining.cost,
    maxWallClockSeconds: Math.min(cfg.budgets.maxWallClockSeconds, budget.remaining.seconds),
  };
  const started = Date.now();
  const result = await adapter.run({ prompt, cwd: repoDir, limits });
  const seconds = (Date.now() - started) / 1000;

  git(repoDir, 'add', '-A');
  const staged = git(repoDir, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
  const diff = git(repoDir, 'diff', '--cached');

  /** @type {InterviewResult['status']} */
  let status = 'ok';
  /** @type {string | undefined} */
  let reason;
  const outside = staged.filter((f) => !ALLOWED.some((p) => f.startsWith(p)));
  if (result.exitStatus !== 0) {
    status = 'failed';
    reason = `agent exited ${result.exitStatus}`;
  } else if (outside.length > 0) {
    status = 'failed';
    reason = `wrote outside specs/ and tests/: ${outside.join(', ')}`;
  } else {
    const lint = lintSpecs(repoDir);
    if (!lint.ok) {
      status = 'failed';
      reason = `spec-lint failed: ${lint.problems.join('; ')}`;
    }
  }

  if (status !== 'ok') {
    // The tree was clean at start, so this discards only the agent's work (kept in diff).
    git(repoDir, 'reset', '-q', '--hard', 'HEAD');
    git(repoDir, 'clean', '-fdq');
  }

  const dir = join(repoDir, 'runs', runId, 'interview');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), prompt);
  writeFileSync(join(dir, 'transcript.txt'), result.transcript);
  writeFileSync(join(dir, 'diff.patch'), diff);
  writeFileSync(
    join(dir, 'record.json'),
    `${JSON.stringify({ status, reason, usage: { ...result.usage, seconds }, changedFiles: result.changedFiles }, null, 2)}\n`,
  );
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', `hodge interview ${runId}: ${status}`);

  return { status, sha: git(repoDir, 'rev-parse', 'HEAD').trim(), ...(reason ? { reason } : {}) };
}
