import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
import { formatTranscript } from './adapter.js';
import { applyResponse, parseResponse, pendingAnswers, readQuestions, unanswered, writeQuestions } from './hodge-questions.js';
import { LOCK_FILE } from './run-lock.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

/** Interview writes specs and objective notes only; tests are the plan stage's job. */
const ALLOWED = ['specs/', 'objective/'];

/** Files code owns: whatever the agent does to them is discarded. */
const CODE_OWNED = ['objective/QUESTIONS.md'];
const RESPONSE_FILE = 'objective/RESPONSE.json';

export function buildInterviewPrompt(repoDir, objective, closing = false, moreQuestions = '', note = '') {
  const specsDir = join(repoDir, 'specs');
  const existing = existsSync(specsDir) ? readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort() : [];
  return [
    loadModePrompt('interview'),
    '## Objective',
    objective.trim(),
    ...kitSections(repoDir, closing, note),
    ...inboxSection('hodge', moreQuestions),
    ...formatSkillSections(repoDir),
    '## Existing specs',
    existing.length === 0 ? '(none)' : existing.map((f) => `- specs/${f}`).join('\n'),
    '## Spec template (templates/spec.md)',
    readFileSync(join(templatesDir, 'spec.md'), 'utf8').trimEnd(),
  ].join('\n\n');
}

// One skill snippet per known format that any spec declares.
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

// Broad until the first spec exists, then fine-grained.
export function stageOf(repoDir) {
  const specsDir = join(repoDir, 'specs');
  return existsSync(specsDir) && readdirSync(specsDir).some((f) => f.endsWith('.md')) ? 'fine' : 'broad';
}

// With an objective kit, the interview prompt carries pointers to the protocol files plus only what changes per
// round: the brief, this round's answers keyed by question id and the stage. The question store and the conversation
// log are code-owned and never shown. The readiness gaps are listed only once the interview is closing (the owner
// said done, or no question was left).
function kitSections(repoDir, closing, note) {
  if (!hasObjectiveKit(repoDir)) return [];
  const gaps = closing ? checkReadiness(repoDir).gaps : [];
  const qs = readQuestions(repoDir);
  const answers = pendingAnswers(qs);
  return [
    '## Kit (read when needed): objective/PHASES.md, objective/INTERVIEW.md (protocol), objective/READINESS.md (what `ready` checks). Never open objective/QUESTIONS.md: the harness asks the questions and tracks their status.',
    `## Answers this round (${answers.length}): Q<id> [topic] question: owner's answer`,
    answers.map((q) => `Q${q.id} [${q.topic}] ${q.text}: ${q.answer}`).join('\n') || '(none)',
    `## Questions still to ask the owner: ${unanswered(qs).length}`,
    `## Stage: ${stageOf(repoDir)}`,
    stageOf(repoDir) === 'broad'
      ? 'No specs yet: look for gaps in purpose, users, capabilities, scope, constraints and success; draft a spec once an answer settles a decision.'
      : 'Specs exist: go deeper on the capability with the most gaps; update specs/ from the answers.',
    'Finish by writing objective/RESPONSE.json (resolved ids and gaps, see above).',
    ...(note ? [`## Previous round`, note] : []),
    ...(closing
      ? [
          '## Readiness gaps (the interview is ending: close these this round)',
          gaps.length === 0 ? '(none: confirm and stop)' : gaps.map((g) => `- ${g}`).join('\n'),
          'Fix gaps the answers already settle; report the rest as gaps in RESPONSE.json (with defaults). Report none only when no gap remains.',
        ]
      : []),
  ];
}

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

// Interview mode: one adapter call that writes specs/ and objective notes. spec-lint (structure only) and the
// readiness check run only when the interview is expected to be over: `closing` (the owner said done) or the agent
// left no question. Problems then keep the round `incomplete` and come back as the next round's gaps, never discarded.
export async function runInterview({ config, repoDir, runId, adapter, objective, round = 1, closing = false, inboxDir = undefined, note = '', identity = undefined }) {
  const v = validateConfig(config);
  if (!v.ok) throw new Error(`invalid config: ${v.errors.join('; ')}`);
  const cfg = config;
  const gated = (reason) => ({ status: 'gated', sha: null, reason });

  if (objective.trim() === '') return gated('objective is empty');
  const self = identity ?? harnessIdentity();
  const g = checkRepoGate(repoDir, self);
  if (!g.ok) return gated(g.reason);
  // `.hodge.lock` lives in the project root now (no separate sandbox dir); exclude it from the
  // dirty-working-tree check since it is harness-internal, never committed.
  if (git(repoDir, 'status', '--porcelain', '--', '.', `:!${LOCK_FILE}`).trim() !== '') return gated('working tree is not clean');
  const budget = checkBudgetGate(repoDir, runId, cfg.budgets);
  if (!budget.ok) return { status: 'over-budget', sha: null, reason: budget.reason };

  const moreQuestions = inboxDir ? readInbox(inboxDir, 'hodge') : '';
  const prompt = buildInterviewPrompt(repoDir, objective, closing, moreQuestions, note);
  const limits = { maxWallClockSeconds: Math.min(cfg.budgets.maxWallClockSeconds, budget.remaining.seconds) };
  const started = Date.now();
  const result = await adapter.run({ prompt, cwd: repoDir, limits });
  const seconds = (Date.now() - started) / 1000;

  const kit = hasObjectiveKit(repoDir);
  let responseText = null;
  if (kit) {
    for (const f of CODE_OWNED) git(repoDir, 'checkout', 'HEAD', '--', f);
    rmSync(join(repoDir, 'objective', 'QUESTION.md'), { force: true });
    if (existsSync(join(repoDir, RESPONSE_FILE))) {
      responseText = readFileSync(join(repoDir, RESPONSE_FILE), 'utf8');
      rmSync(join(repoDir, RESPONSE_FILE));
    }
  }

  git(repoDir, 'add', '-A', '--', '.', `:!${LOCK_FILE}`);
  let staged = git(repoDir, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);

  let status = 'ok';
  let reason;
  const outside = staged.filter((f) => !ALLOWED.some((p) => f.startsWith(p)));
  let badResponse;
  if (kit && result.exitStatus === 0 && outside.length === 0) {
    // Code, not the agent, updates question status; a missing response is an empty one.
    const qs = readQuestions(repoDir);
    const parsed = parseResponse(responseText ?? '{"resolved":[],"gaps":[]}', pendingAnswers(qs).map((q) => q.id));
    if (parsed.ok) {
      writeQuestions(repoDir, applyResponse(qs, parsed.response));
      git(repoDir, 'add', '-A', '--', '.', `:!${LOCK_FILE}`);
      staged = git(repoDir, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
    } else badResponse = `invalid ${RESPONSE_FILE}: ${parsed.reason}`;
  }
  const diff = git(repoDir, 'diff', '--cached');
  // No question left to ask the owner means the agent claims the specs are ready.
  const checking = closing || (kit ? unanswered(readQuestions(repoDir)).length === 0 : true);
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
  } else if (badResponse) {
    status = 'incomplete';
    reason = badResponse;
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
    git(repoDir, 'clean', '-fdq', '-e', LOCK_FILE);
  }

  const dir = join(repoDir, 'runs', runId, round === 1 ? 'interview' : `interview-${round}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'transcript.txt'), formatTranscript(prompt, result.transcript));
  writeFileSync(join(dir, 'diff.patch'), diff);
  writeFileSync(
    join(dir, 'record.json'),
    `${JSON.stringify({ status, reason, usage: { seconds }, changedFiles: result.changedFiles }, null, 2)}\n`,
  );
  if (inboxDir && (status === 'ok' || status === 'incomplete')) consumeInbox(inboxDir, 'hodge', moreQuestions);
  git(repoDir, 'add', '-A', '--', '.', `:!${LOCK_FILE}`);
  git(repoDir, 'commit', '-q', '--allow-empty', '-m', `hodge ${runId}: ${status}`);

  return { status, sha: git(repoDir, 'rev-parse', 'HEAD').trim(), ...(reason ? { reason } : {}) };
}
