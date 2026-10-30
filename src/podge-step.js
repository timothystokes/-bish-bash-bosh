import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './config.js';
import { checkAntiStubGate, checkScopeGate, checkTypeGate } from './diff-gates.js';
import { checkTestPlanGate } from './podge-test-plan-gate.js';
import { lintSpecs } from './spec-lint.js';
import { checkRepoGate, harnessIdentity } from './repo-gate.js';
import { writeIterationRecord } from './podge-run-record.js';
import { diagnose } from './podge-diagnosis.js';
import { loadModePrompt } from './prompts.js';
import { nextItem } from './podge-next-item.js';
import { checkBrownfieldGate } from './podge-brownfield-gate.js';
import { checkHardeningGate } from './podge-hardening-gate.js';
import { checkCleanRoomGate } from './clean-room.js';
import { checkTestsNoRegression, isPlanningOnly, runTests } from './podge-test-gate.js';
import { checkFormatGate, declaresFormats } from './formats.js';
import { consumeInbox, inboxSection, readInbox } from './inbox.js';
import { LOCK_FILE } from './run-lock.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

const readIfExists = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

// Spec pointers only (path + title): the agent opens a spec when its item needs it.
export function buildContext(repoDir) {
  const specsDir = join(repoDir, 'specs');
  const specs = existsSync(specsDir)
    ? readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort()
    : [];
  const index = specs.map((f) => {
    const title = readFileSync(join(specsDir, f), 'utf8').split('\n')[0];
    return `- specs/${f}: ${title}`;
  });
  return ['## Specs (open only what you need)', index.join('\n')].join('\n\n');
}

// The one plan.md item this iteration works on, never the rest of the plan.
function itemSection(repoDir) {
  const item = nextItem(readIfExists(join(repoDir, 'plan.md')));
  if (!item) return '## Your item\n\nNone: plan.md has no unchecked item.';
  const more = item.open > 1 ? ` (${item.open - 1} more open in plan.md; ignore them)` : '';
  return `## Your item${more}\n\n${item.text}`;
}

// Per-iteration context: loop prompt + your one plan item + spec pointers. Nothing grows with plan.md.
export function buildPrompt(repoDir, mode = 'forward', steer, moreTodos = '') {
  return [
    loadModePrompt(mode),
    itemSection(repoDir),
    buildContext(repoDir),
    ...(steer ? ['## Steer note', steer] : []),
    ...inboxSection('podge', moreTodos),
  ].join('\n\n');
}

// Prompt for the plan step: plan prompt + test-plan template + spec pointers (plan.md is in the repo).
export function buildPlanPrompt(repoDir, steer, moreTodos = '') {
  return [
    loadModePrompt('plan'),
    '## Test-plan template (templates/tests-PLAN.md)',
    readFileSync(join(templatesDir, 'tests-PLAN.md'), 'utf8').trimEnd(),
    buildContext(repoDir),
    ...(steer ? ['## Steer note', steer] : []),
    ...inboxSection('podge', moreTodos),
  ].join('\n\n');
}

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

function nextIteration(dir, runId) {
  const base = join(dir, '.hodgepodge', 'runs', runId, 'iterations');
  if (!existsSync(base)) return 1;
  const nums = readdirSync(base).filter((n) => /^\d+$/.test(n)).map(Number);
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
}

// What the plan step must leave behind: every spec and requirement mapped in tests/PLAN.md, the mapped tests
// present, and the suite red.
function checkPlanStepOutput(repoDir, testCommand) {
  const lint = lintSpecs(repoDir);
  if (!lint.ok) return { ok: false, reason: `spec-lint failed: ${lint.problems.join('; ')}` };
  return checkTestPlanGate(repoDir, { testCommand, requireRed: true });
}

// One idempotent loop iteration: gates, agent call, scoped tests, commit, run record.
export async function runStep({ config, repoDir, runId, adapter, testCommand = ['npm', 'test'], typeCommand = undefined, requireTestPlan = false, steer = undefined, inboxDir = undefined, identity = undefined, log = (_message) => {} }) {
  const v = validateConfig(config);
  if (!v.ok) throw new Error(`invalid config: ${v.errors.join('; ')}`);
  const cfg = config;

  const self = identity ?? harnessIdentity();
  const gated = (reason) => (log(`step gated: ${reason}`), { sha: null, iteration: 0, status: 'gated', reason });
  const g = checkRepoGate(repoDir, self);
  if (!g.ok) return gated(g.reason);
  // `.hodgepodge/lock` is harness-internal; exclude it from the
  // dirty-working-tree check since it is harness-internal, never committed.
  if (git(repoDir, 'status', '--porcelain', '--', '.', `:!${LOCK_FILE}`).trim() !== '') {
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

  const iteration = nextIteration(repoDir, runId);
  // The test plan is the first step's output: with specs but no tests/PLAN.md, this step writes it (red tests + plan.md).
  const planStep = requireTestPlan && (cfg.mode ?? 'forward') === 'forward' && !existsSync(join(repoDir, 'tests', 'PLAN.md'));
  if (requireTestPlan && !planStep) {
    const plan = checkTestPlanGate(repoDir, { testCommand, requireRed: iteration === 1 });
    if (!plan.ok) return gated(plan.reason ?? 'test-plan gate failed');
  }
  const baseline = runTests(testCommand, repoDir);
  const moreTodos = inboxDir ? readInbox(inboxDir, 'podge') : '';
  const prompt = planStep ? buildPlanPrompt(repoDir, steer, moreTodos) : buildPrompt(repoDir, cfg.mode, steer, moreTodos);
  const started = Date.now();
  const result = await adapter.run({
    prompt,
    cwd: repoDir,
    limits: {},
  });
  const seconds = (Date.now() - started) / 1000;

  git(repoDir, 'add', '-A', '--', '.', `:!${LOCK_FILE}`);
  const diff = git(repoDir, 'diff', '--cached');

  let status = 'ok';
  let test = { skipped: true, exitStatus: undefined, output: undefined, reason: undefined };
  const gates = [{ name: 'repo', ok: true }];
  if (requireTestPlan && !planStep) gates.push({ name: 'test-plan', ok: true });
  const preGates = gates.length;
  const record = (name, c) => {
    gates.push({ name, ok: c.ok, detail: c.ok ? c.detail : c.reason });
    return c.ok;
  };
  if (result.exitStatus !== 0) {
    status = 'failed';
  } else {
    const staged = git(repoDir, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
    const diffOk = [
      record('scope', checkScopeGate(staged, planStep ? ['plan.md', 'tests/'] : cfg.allowedPaths)),
      record('anti-stub', checkAntiStubGate(diff)),
      ...(declaresFormats(repoDir) ? [record('formats', checkFormatGate(repoDir))] : []),
      ...(hardening ? [record('tests-only', checkScopeGate(staged, ['tests/']))] : []),
    ].every(Boolean);
    if (!diffOk) {
      status = 'failed';
    } else {
      // The plan step's tests are red by design, so the regression gate does not apply; its own gate below does.
      const planning = planStep || isPlanningOnly(staged);
      const t = planning ? null : checkTestsNoRegression(runTests(testCommand, repoDir), baseline);
      test = t
        ? { skipped: undefined, exitStatus: t.exitStatus, output: t.output, reason: undefined }
        : { skipped: true, exitStatus: undefined, output: undefined, reason: 'planning-only' };
      const testsOk = t ? t.ok : true;
      gates.push({ name: 'tests', ok: testsOk, detail: t ? t.detail : 'skipped (planning-only)' });
      const planOk = !planStep || record('test-plan', checkPlanStepOutput(repoDir, testCommand));
      const typesOk = record('types', checkTypeGate(repoDir, typeCommand));
      const hardenOk = !hardening || !testsOk || record('hardening', checkHardeningGate(repoDir, cfg.hardenCommand));
      if (!testsOk || !planOk || !typesOk || !hardenOk) status = 'failed';
    }
  }

  if (status !== 'ok') {
    // The tree was clean at start, so resetting discards only the agent's work (kept in diff).
    git(repoDir, 'reset', '-q', '--hard', 'HEAD');
    git(repoDir, 'clean', '-fdq', '-e', LOCK_FILE);
  }

  const finalGates = status === 'ok' || gates.length > preGates ? gates : [...gates, { name: 'tests', ok: false, detail: status }];
  for (const g of finalGates) log(`gate ${g.name}: ${g.ok ? 'ok' : 'FAILED'}${g.detail ? ` (${g.detail})` : ''}`);
  const failedTest = test;
  if (status !== 'ok' && failedTest.output) log(`test output:\n${failedTest.output}`);
  log(`step ${iteration}: ${status}`);
  const diagnosis = diagnose({ status, gates: finalGates, transcript: result.transcript });
  writeIterationRecord(repoDir, runId, iteration, {
    status,
    usage: { seconds },
    changedFiles: result.changedFiles,
    gates: finalGates,
    prompt,
    transcript: result.transcript,
    diff,
    test,
    ...(diagnosis ? { diagnosis } : {}),
  });
  git(repoDir, 'add', '-A', '--', '.', `:!${LOCK_FILE}`);
  if (inboxDir && status === 'ok') consumeInbox(inboxDir, 'podge', moreTodos);
  git(repoDir, 'commit', '-q', '--allow-empty', '-m', `podge step ${runId}/${String(iteration).padStart(3, '0')}: ${status}`);

  return {
    sha: git(repoDir, 'rev-parse', 'HEAD').trim(), iteration, status,
    ...(diagnosis ? { reason: diagnosis.rootCause } : {}),
  };
}
