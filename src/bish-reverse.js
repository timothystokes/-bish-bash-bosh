import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './config.js';
import { checkRepoGate, harnessIdentity } from './repo-gate.js';
import { lintSpecs } from './spec-lint.js';
import { loadModePrompt } from './prompts.js';
import { LOCK_FILE } from './run-lock.js';
import { formatTranscript } from './adapter.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

/** Reverse may only write specs and the characterization tests; the source stays unchanged. */
const ALLOWED = ['specs/', 'tests/'];

export function buildReversePrompt(repoDir, focus) {
  const specsDir = join(repoDir, 'specs');
  const existing = existsSync(specsDir) ? readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort() : [];
  return [
    loadModePrompt('reverse'),
    '## Focus',
    focus && focus.trim() !== '' ? focus.trim() : 'Whole codebase',
    '## Existing specs',
    existing.length === 0 ? '(none)' : existing.map((f) => `- specs/${f}`).join('\n'),
    '## Spec template (templates/spec.md)',
    readFileSync(join(templatesDir, 'spec.md'), 'utf8').trimEnd(),
    '## Test-plan template (templates/tests-PLAN.md)',
    readFileSync(join(templatesDir, 'tests-PLAN.md'), 'utf8').trimEnd(),
  ].join('\n\n');
}

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

// Reverse mode: one adapter call that writes specs/ and tests/ from existing code. Accepted only if
// nothing else changed, spec-lint passes and the characterization suite is green on the unchanged source.
export async function runReverse({ config, repoDir, runId, adapter, focus = undefined, testCommand = ['npm', 'test'], identity }) {
  const v = validateConfig(config);
  if (!v.ok) throw new Error(`invalid config: ${v.errors.join('; ')}`);
  const gated = (reason) => ({ status: 'gated', sha: null, reason });

  const self = identity ?? harnessIdentity();
  const g = checkRepoGate(repoDir, self);
  if (!g.ok) return gated(g.reason);
  // `.bish-bash-bosh/lock` is harness-internal; exclude it from the
  // dirty-working-tree check since it is harness-internal, never committed.
  if (git(repoDir, 'status', '--porcelain', '--', '.', `:!${LOCK_FILE}`).trim() !== '') return gated('working tree is not clean');

  const prompt = buildReversePrompt(repoDir, focus);
  const limits = {};
  const started = Date.now();
  const result = await adapter.run({ prompt, cwd: repoDir, limits });
  const seconds = (Date.now() - started) / 1000;

  git(repoDir, 'add', '-A', '--', '.', `:!${LOCK_FILE}`);
  const staged = git(repoDir, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
  const diff = git(repoDir, 'diff', '--cached');

  let status = 'ok';
  let reason;
  let test;
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
    } else {
      const [cmd, ...args] = testCommand;
      const t = spawnSync(cmd, args, { cwd: repoDir, encoding: 'utf8' });
      test = { exitStatus: t.status ?? 1, output: `${t.stdout ?? ''}${t.stderr ?? ''}` };
      if (t.status !== 0) {
        status = 'failed';
        reason = 'characterization suite is not green against the unchanged source';
      }
    }
  }

  if (status !== 'ok') {
    // The tree was clean at start, so this discards only the agent's work (kept in diff).
    git(repoDir, 'reset', '-q', '--hard', 'HEAD');
    git(repoDir, 'clean', '-fdq', '-e', LOCK_FILE);
  }

  const dir = join(repoDir, '.bish-bash-bosh', 'runs', runId, 'reverse');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'transcript.txt'), formatTranscript(prompt, result.transcript));
  writeFileSync(join(dir, 'diff.patch'), diff);
  writeFileSync(
    join(dir, 'record.json'),
    `${JSON.stringify({ status, reason, test, usage: { seconds }, changedFiles: result.changedFiles }, null, 2)}\n`,
  );
  git(repoDir, 'add', '-A', '--', '.', `:!${LOCK_FILE}`);
  git(repoDir, 'commit', '-q', '-m', `bish --reverse ${runId}: ${status}`);

  return { status, sha: git(repoDir, 'rev-parse', 'HEAD').trim(), ...(reason ? { reason } : {}) };
}
