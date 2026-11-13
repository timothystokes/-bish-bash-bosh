// The harness (never the agents) owns git: the project must be a git repo, and each loop's completed unit of work is
// committed here (never pushed). The run lock is harness-internal and never committed.
import { execFileSync } from 'node:child_process';
import { LOCK_FILE } from './run-lock.js';

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function isGitRepo(dir) {
  try {
    return git(dir, 'rev-parse', '--is-inside-work-tree').trim() === 'true';
  } catch {
    return false;
  }
}

// Collapses a commit subject to one line of at most 100 characters.
export function subject(text) {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 100 ? `${one.slice(0, 99).trimEnd()}…` : one;
}

// Stages everything under `dir` (except the run lock) and commits it. Returns false when there was nothing to
// commit; throws with git's own message when the commit fails (for example no user.name/user.email configured).
export function commitAll(dir, message) {
  try {
    git(dir, 'add', '-A', '--', '.', `:!${LOCK_FILE}`);
    if (git(dir, 'diff', '--cached', '--name-only').trim() === '') return false;
    git(dir, 'commit', '-q', '-m', message);
    return true;
  } catch (e) {
    throw new Error(`git commit failed: ${(e.stderr?.toString() || e.message).trim()}`);
  }
}
