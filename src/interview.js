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
import { consumeInbox, inboxSection, readInbox } from './inbox.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

/** Interview writes specs and objective notes only; tests are the plan stage's job. */
const ALLOWED = ['specs/', 'objective/'];

/**
 * @typedef {{status: 'ok' | 'incomplete' | 'failed' | 'gated' | 'over-budget', sha: string | null, reason?: string}} InterviewResult
 */

/**
 * @param {string} repoDir
 * @param {string} objective
 * @param {boolean} [closing] the interview is expected to end this round: list the readiness gaps to close
 * @param {string} [moreQuestions] pending outer-console entries
 * @returns {string}
 */
export function buildInterviewPrompt(repoDir, objective, closing = false, moreQuestions = '') {
  const specsDir = join(repoDir, 'specs');
  const existing = existsSync(specsDir) ? readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort() : [];
  return [
    loadModePrompt('interview'),
    '## Objective',
    objective.trim(),
    ...kitSections(repoDir, closing),
    ...inboxSection('hodge', moreQuestions),
    ...formatSkillSections(repoDir),
    '## Existing specs',
    existing.length === 0 ? '(none)' : existing.map((f) => `- specs/${f}`).join('\n'),
    '## Spec template (templates/spec.md)',
    readFileSync(join(templatesDir, 'spec.md'), 'utf8').trimEnd(),
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

const CONVERSATION_TAIL_CHARS = 1500;
const OPEN_QUESTIONS_SHOWN = 10;

/**
 * With an objective kit, the interview prompt carries pointers to the protocol files plus only what changes per
 * round: the brief, the open questions, the conversation tail and the stage. The readiness gaps are listed only
 * once the interview is closing (the owner said done, or the agent had no more questions).
 * @param {string} repoDir
 * @param {boolean} closing
 * @returns {string[]}
 */
function kitSections(repoDir, closing) {
  if (!hasObjectiveKit(repoDir)) return [];
  const read = (/** @type {string} */ f) => {
    const p = join(repoDir, 'objective', f);
    return existsSync(p) ? readFileSync(p, 'utf8').trimEnd() : '';
  };
  const gaps = closing ? checkReadiness(repoDir).gaps : [];
  const open = read('OPEN-QUESTIONS.md').split('\n').filter((l) => /^\s*[-*] \[ \] /.test(l));
  const convo = read('CONVERSATION.md');
  return [
    '## Kit (read when needed): objective/PHASES.md, objective/INTERVIEW.md (protocol), objective/READINESS.md (what `ready` checks)',
    '## objective/BRIEF.md',
    read('BRIEF.md'),
    `## Open questions (${open.length} unchecked; objective/OPEN-QUESTIONS.md)`,
    open.slice(0, OPEN_QUESTIONS_SHOWN).join('\n') || '(none)',
    `## objective/CONVERSATION.md (tail; the owner's answers so far)`,
    convo.length > CONVERSATION_TAIL_CHARS ? `...${convo.slice(-CONVERSATION_TAIL_CHARS)}` : convo,
    `## Stage: ${stageOf(repoDir)}`,
    stageOf(repoDir) === 'broad'
      ? 'No specs yet: ask broad questions (purpose, users, capabilities, scope, constraints, success); draft a spec once an answer settles a decision. Write the next question batch to objective/QUESTION.md.'
      : 'Specs exist: go deeper on the capability with the most gaps; update specs/ from the answers. Write the next question batch to objective/QUESTION.md.',
    ...(closing
      ? [
          '## Readiness gaps (the interview is ending: close these this round)',
          gaps.length === 0 ? '(none: confirm and stop)' : gaps.map((g) => `- ${g}`).join('\n'),
          'Fix gaps the answers already settle; ask the owner about the rest (batch with defaults). Write no question only when no gap remains.',
        ]
      : []),
  ];
}

/**
 * @param {string} dir
 * @param {string[]} args
 */
const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

/**
 * Interview mode: one adapter call that writes specs/ and objective notes. spec-lint (structure only) and the
 * readiness check run only when the interview is expected to be over: `closing` (the owner said done) or the agent
 * left no question. Problems then keep the round `incomplete` and come back as the next round's gaps, never discarded.
 * @param {{
 *   config: unknown,
 *   repoDir: string,
 *   runId: string,
 *   adapter: import('./adapter.js').Adapter,
 *   objective: string,
 *   round?: number,
 *   closing?: boolean,
 *   inboxDir?: string,
 *   identity?: import('./repo-gate.js').HarnessIdentity,
 * }} opts
 * @returns {Promise<InterviewResult>}
 */
export async function runInterview({ config, repoDir, runId, adapter, objective, round = 1, closing = false, inboxDir, identity }) {
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

  const moreQuestions = inboxDir ? readInbox(inboxDir, 'hodge') : '';
  const prompt = buildInterviewPrompt(repoDir, objective, closing, moreQuestions);
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
  // No question left for the owner means the agent claims the specs are ready.
  const checking = closing || !existsSync(join(repoDir, 'objective', 'QUESTION.md'));
  /** @returns {string | undefined} the gaps that keep the interview open */
  const openGaps = () => {
    const gaps = hasObjectiveKit(repoDir) ? checkReadiness(repoDir).gaps : lintSpecs(repoDir, { testPlan: false }).problems;
    return gaps.length > 0 ? `not ready: ${gaps.join('; ')}` : undefined;
  };
  if (result.exitStatus !== 0) {
    status = 'failed';
    reason = `agent exited ${result.exitStatus}`;
  } else if (outside.length > 0) {
    status = 'failed';
    reason = `wrote outside specs/ and objective/: ${outside.join(', ')}`;
  } else if (staged.length === 0 && !(closing && !openGaps())) {
    status = 'failed';
    reason = 'agent made no changes (nothing written to objective/ or specs/)';
  } else if (!checking) {
    status = 'incomplete';
    reason = 'interview in progress: waiting for the owner\'s answer';
  } else {
    // Only here is the interview expected to be over: problems come back as the next round's gaps, work is kept.
    const gaps = openGaps();
    if (gaps) {
      status = 'incomplete';
      reason = gaps;
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
  if (inboxDir && (status === 'ok' || status === 'incomplete')) consumeInbox(inboxDir, 'hodge', moreQuestions);
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '--allow-empty', '-m', `hodge ${runId}: ${status}`);

  return { status, sha: git(repoDir, 'rev-parse', 'HEAD').trim(), ...(reason ? { reason } : {}) };
}
