import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateDiagnosis } from './podge-diagnosis.js';
import { checkBudgetGate } from './budget-gate.js';
import { checkRepoGate, harnessIdentity } from './repo-gate.js';
import { loadQaPrompt } from './prompts.js';
import { buildContext } from './podge-step.js';
import { LOCK_FILE } from './run-lock.js';

export const CLASSIFICATIONS = ['violated-decision', 'unimplemented-requirement', 'decision-needing-replacement'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const DEFAULT_MAX_QA_CYCLES = 5;
const HEADING = '## QA findings';

export function validateFinding(f) {
  if (typeof f !== 'object' || f === null) return { ok: false, errors: ['finding must be an object'] };
  const o = f;
  const errors = [];
  if (!CLASSIFICATIONS.includes((o['classification']))) errors.push(`finding.classification must be one of ${CLASSIFICATIONS.join(', ')}`);
  if (!SEVERITIES.includes((o['severity']))) errors.push(`finding.severity must be one of ${SEVERITIES.join(', ')}`);
  for (const k of ['spec', 'consequence']) {
    if (typeof o[k] !== 'string' || o[k].trim() === '') errors.push(`finding.${k} must be a non-empty string`);
  }
  errors.push(...validateDiagnosis(o['diagnosis']).errors);
  return { ok: errors.length === 0, errors };
}

// The evaluator reports in its last fenced ```findings block (a JSON array; `[]` means clean).
// A missing, malformed or invalid report is an error: silence is never a pass.
export function parseFindings(transcript) {
  const blocks = [...transcript.matchAll(/```findings\s*\n([\s\S]*?)\n```/g)];
  const last = blocks.at(-1);
  if (!last) return { ok: false, error: 'qa reply has no fenced `findings` block' };
  let parsed;
  try {
    parsed = JSON.parse(last[1]);
  } catch {
    return { ok: false, error: 'qa `findings` block is not valid JSON' };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: 'qa `findings` block must be a JSON array' };
  const errors = parsed.flatMap((f, i) => validateFinding(f).errors.map((e) => `#${i + 1}: ${e}`));
  if (errors.length > 0) return { ok: false, error: `invalid qa findings: ${errors.join('; ')}` };
  return { ok: true, findings: (parsed) };
}

const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

// Hand findings back to `podge` as unchecked plan items under `## QA findings`.
export function findingsToPlanItems(plan, cycle, findings) {
  const items = findings.map((f, i) =>
    `- [ ] QA-${cycle}-${i + 1} [${f.severity}] ${f.classification} (${oneLine(f.spec)}): ${oneLine(f.diagnosis.fix)} | evidence: ${oneLine(f.diagnosis.evidence)} | consequence: ${oneLine(f.consequence)}`);
  const base = plan.endsWith('\n') || plan === '' ? plan : `${plan}\n`;
  const heading = new RegExp(`^${HEADING}$`, 'm').test(base) ? '' : `\n${HEADING}\n`;
  return `${base}${heading}${items.join('\n')}\n`;
}

// Number of QA cycles already recorded for a run (`runs/<runId>/qa-N/`).
export function qaCycles(repoDir, runId) {
  const dir = join(repoDir, 'runs', runId);
  if (!existsSync(dir)) return 0;
  const nums = readdirSync(dir).map((d) => /^qa-(\d+)$/.exec(d)?.[1]).filter(Boolean).map(Number);
  return nums.length === 0 ? 0 : Math.max(...nums);
}

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

// One QA cycle: an independent evaluator (the `qa` role's adapter) checks the build against the specs. Read-only:
// any change it makes is discarded and fails the cycle. Findings become unchecked plan items, committed.
export async function runQaCycle({ config, repoDir, runId, adapter, identity }) {
  const cfg = config;
  const cycle = qaCycles(repoDir, runId) + 1;
  const self = identity ?? harnessIdentity();
  const g = checkRepoGate(repoDir, self);
  if (!g.ok) return { status: 'gated', cycle, reason: g.reason };
  // `.hodge.lock` lives in the project root now (no separate sandbox dir); exclude it from the
  // dirty-working-tree check since it is harness-internal, never committed.
  if (git(repoDir, 'status', '--porcelain', '--', '.', `:!${LOCK_FILE}`).trim() !== '') return { status: 'gated', cycle, reason: 'working tree is not clean' };
  const budget = checkBudgetGate(repoDir, runId, cfg.budgets);
  if (!budget.ok) return { status: 'over-budget', cycle, reason: budget.reason };

  const prompt = [loadQaPrompt(), buildContext(repoDir)].join('\n\n');
  const started = Date.now();
  const result = await adapter.run({
    prompt,
    cwd: repoDir,
    limits: { maxWallClockSeconds: Math.min(cfg.budgets.maxWallClockSeconds, budget.remaining.seconds) },
  });
  const seconds = (Date.now() - started) / 1000;

  let res;
  const touched = git(repoDir, 'status', '--porcelain', '--', '.', `:!${LOCK_FILE}`).trim() !== '';
  if (touched) {
    git(repoDir, 'reset', '-q', '--hard', 'HEAD');
    git(repoDir, 'clean', '-fdq', '-e', LOCK_FILE);
  }
  const parsed = parseFindings(result.transcript);
  if (result.exitStatus !== 0) {
    res = { status: 'failed', cycle, reason: 'qa agent call exited non-zero' };
  } else if (touched) {
    res = { status: 'failed', cycle, reason: 'qa modified the workspace (read-only role); changes discarded' };
  } else if (!parsed.ok) {
    res = { status: 'failed', cycle, reason: parsed.error };
  } else {
    res = { status: parsed.findings.length === 0 ? 'clean' : 'findings', cycle, findings: parsed.findings };
  }

  const dir = join(repoDir, 'runs', runId, `qa-${cycle}`);
  const tmp = `${dir}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, 'prompt.md'), prompt);
  writeFileSync(join(tmp, 'transcript.txt'), result.transcript);
  writeFileSync(join(tmp, 'findings.json'), `${JSON.stringify(res.findings ?? [], null, 2)}\n`);
  writeFileSync(join(tmp, 'record.json'), `${JSON.stringify({ status: res.status, cycle, ...(res.reason ? { reason: res.reason } : {}), usage: { seconds } }, null, 2)}\n`);
  renameSync(tmp, dir);
  if (res.status === 'findings' && res.findings) {
    const planPath = join(repoDir, 'plan.md');
    writeFileSync(planPath, findingsToPlanItems(existsSync(planPath) ? readFileSync(planPath, 'utf8') : '', cycle, res.findings));
  }
  git(repoDir, 'add', '-A', '--', '.', `:!${LOCK_FILE}`);
  git(repoDir, 'commit', '-q', '--allow-empty', '-m', `qa ${runId}/${cycle}: ${res.status}`);
  return res;
}
