import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './config.js';
import { checkBudgetGate } from './budget-gate.js';
import { checkRepoGate, harnessIdentity } from './repo-gate.js';
import { lintSpecs } from './spec-lint.js';
import { loadFormatSkill, loadModePrompt } from './prompts.js';
import { FORMATS, parseFormats } from './formats.js';
import { checkReadiness, hasObjectiveKit } from './readiness.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

/** Interview may only write specs and the tests that prove them. */
const ALLOWED = ['specs/', 'tests/', 'objective/'];

/**
 * @typedef {{status: 'ok' | 'incomplete' | 'failed' | 'gated' | 'over-budget', sha: string | null, reason?: string}} InterviewResult
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
    ...kitSections(repoDir),
    ...formatSkillSections(repoDir),
    '## Existing specs',
    existing.length === 0 ? '(none)' : existing.map((f) => `- specs/${f}`).join('\n'),
    '## Spec template (templates/spec.md)',
    readFileSync(join(templatesDir, 'spec.md'), 'utf8').trimEnd(),
    '## Test-plan template (templates/tests-PLAN.md)',
    readFileSync(join(templatesDir, 'tests-PLAN.md'), 'utf8').trimEnd(),
  ].join('\n\n');
}

/**
 * One skill snippet per known format that any spec declares.
 * @param {string} repoDir
 * @returns {string[]}
 */
function formatSkillSections(repoDir) {
  const specsDir = join(repoDir, 'specs');
  if (!existsSync(specsDir)) return [];
  const names = new Set();
  for (const f of readdirSync(specsDir).filter((x) => x.endsWith('.md')).sort()) {
    for (const d of parseFormats(readFileSync(join(specsDir, f), 'utf8')).declared) {
      if (Object.hasOwn(FORMATS, d.format)) names.add(d.format);
    }
  }
  return [...names].sort().flatMap((n) => [`## Format skill: ${n}`, loadFormatSkill(n)]);
}

/**
 * Broad until the first spec exists, then fine-grained.
 * @param {string} repoDir
 * @returns {'broad' | 'fine'}
 */
export function stageOf(repoDir) {
  const specsDir = join(repoDir, 'specs');
  return existsSync(specsDir) && readdirSync(specsDir).some((f) => f.endsWith('.md')) ? 'fine' : 'broad';
}

/**
 * With an objective kit, the interview prompt also carries the protocol, the readiness signals,
 * the brief, the open questions and the gaps still to close (so each round starts where the last stopped).
 * @param {string} repoDir
 * @returns {string[]}
 */
function kitSections(repoDir) {
  if (!hasObjectiveKit(repoDir)) return [];
  const read = (/** @type {string} */ f) => {
    const p = join(repoDir, 'objective', f);
    return existsSync(p) ? readFileSync(p, 'utf8').trimEnd() : '(missing)';
  };
  const { gaps } = checkReadiness(repoDir);
  return [
    '## objective/PHASES.md',
    read('PHASES.md'),
    '## objective/INTERVIEW.md',
    read('INTERVIEW.md'),
    '## objective/READINESS.md',
    read('READINESS.md'),
    '## objective/BRIEF.md',
    read('BRIEF.md'),
    '## objective/OPEN-QUESTIONS.md',
    read('OPEN-QUESTIONS.md'),
    '## objective/CONVERSATION.md (questions asked and the owner\'s answers so far)',
    read('CONVERSATION.md'),
    `## Stage: ${stageOf(repoDir)}`,
    stageOf(repoDir) === 'broad'
      ? 'No specs exist yet. Ask broad questions only (purpose, users, capabilities, scope, constraints, success). Once an answer settles a decision, draft its spec and tests from it and queue perceived gaps in objective/OPEN-QUESTIONS.md; otherwise write notes to objective/. Write the next question, with a `Default: <answer>` last line, to objective/QUESTION.md.'
      : 'Specs exist. Go deeper on the capability with the most gaps, down to individual requirements, failure paths and examples. Draft or update specs/ and tests/ for everything already answered, add perceived gaps to objective/OPEN-QUESTIONS.md, then write the next question, with a `Default: <answer>` last line, to objective/QUESTION.md.',
    '## Readiness gaps (close these this round)',
    gaps.length === 0 ? '(none: confirm and stop)' : gaps.map((g) => `- ${g}`).join('\n'),
  ];
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
 *   round?: number,
 *   identity?: import('./repo-gate.js').HarnessIdentity,
 * }} opts
 * @returns {Promise<InterviewResult>}
 */
export async function runInterview({ config, repoDir, runId, adapter, objective, round = 1, identity }) {
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
  const discoveryOnly = hasObjectiveKit(repoDir) && staged.length > 0 && staged.every((f) => f.startsWith('objective/'));
  const outside = staged.filter((f) => !ALLOWED.some((p) => f.startsWith(p)));
  if (result.exitStatus !== 0) {
    status = 'failed';
    reason = `agent exited ${result.exitStatus}`;
  } else if (outside.length > 0) {
    status = 'failed';
    reason = `wrote outside specs/ and tests/: ${outside.join(', ')}`;
  } else if (discoveryOnly) {
    // Broad rounds only write notes and the next question; specs and their lint come later.
    status = 'incomplete';
    reason = 'discovery in progress: no specs written yet';
  } else {
    const lint = lintSpecs(repoDir);
    if (!lint.ok) {
      status = 'failed';
      reason = `spec-lint failed: ${lint.problems.join('; ')}`;
    } else if (hasObjectiveKit(repoDir)) {
      // A round that moved forward but is not ready yet is kept; the next round resumes from its gaps.
      const ready = checkReadiness(repoDir);
      if (!ready.ready) {
        status = 'incomplete';
        reason = `not ready: ${ready.gaps.join('; ')}`;
      }
    }
  }

  if (status === 'failed') {
    // The tree was clean at start, so this discards only the agent's work (kept in diff).
    git(repoDir, 'reset', '-q', '--hard', 'HEAD');
    git(repoDir, 'clean', '-fdq');
  }

  const dir = join(repoDir, 'runs', runId, round === 1 ? 'interview' : `interview-${round}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), prompt);
  writeFileSync(join(dir, 'transcript.txt'), result.transcript);
  writeFileSync(join(dir, 'diff.patch'), diff);
  writeFileSync(
    join(dir, 'record.json'),
    `${JSON.stringify({ status, reason, usage: { ...result.usage, seconds }, changedFiles: result.changedFiles }, null, 2)}\n`,
  );
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '--allow-empty', '-m', `hodge ${runId}: ${status}`);

  return { status, sha: git(repoDir, 'rev-parse', 'HEAD').trim(), ...(reason ? { reason } : {}) };
}
