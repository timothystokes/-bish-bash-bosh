import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../shared/config.js';
import { checkRepoGate, harnessIdentity } from '../shared/repo-gate.js';
import { parseSpecificationItems } from '../bash/bash-planner.js';
import reverseEngineerPrompt from './prompts/bish-reverse-engineer.js';
import { LOCK_FILE } from '../shared/run-lock.js';
import { formatTranscript } from '../adapters/adapter.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), 'templates');

/** Reverse may only write the specification; the source stays unchanged. */
export const SPEC_PATH = '.bish-bash-bosh/specification.md';

export function buildReversePrompt(repoDir, focus) {
  return reverseEngineerPrompt(
    focus && focus.trim() !== '' ? focus.trim() : 'Whole codebase',
    readFileSync(join(templatesDir, 'bish-specification.md'), 'utf8').trimEnd(),
  );
}

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

// Reverse mode: one adapter call that writes `.bish-bash-bosh/specification.md` from existing code. Accepted
// only if nothing else changed and the specification holds at least one well-formed item.
export async function runReverse({ config, repoDir, runId, adapter, focus = undefined, identity }) {
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
  const outside = staged.filter((f) => f !== SPEC_PATH && !f.startsWith('.bish-bash-bosh/runs/'));
  if (result.exitStatus !== 0) {
    status = 'failed';
    reason = `agent exited ${result.exitStatus}`;
  } else if (outside.length > 0) {
    status = 'failed';
    reason = `wrote outside the specification: ${outside.join(', ')}`;
  } else {
    const spec = existsSync(join(repoDir, SPEC_PATH)) ? readFileSync(join(repoDir, SPEC_PATH), 'utf8') : '';
    if (parseSpecificationItems(spec).length === 0) {
      status = 'failed';
      reason = 'specification.md has no `<n>. [ ] C: <constraint> B: <benefit>` items';
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
    `${JSON.stringify({ status, reason, usage: { seconds }, changedFiles: result.changedFiles }, null, 2)}\n`,
  );
  git(repoDir, 'add', '-A', '--', '.', `:!${LOCK_FILE}`);
  git(repoDir, 'commit', '-q', '-m', `bish --reverse ${runId}: ${status}`);

  return { status, sha: git(repoDir, 'rev-parse', 'HEAD').trim(), ...(reason ? { reason } : {}) };
}
