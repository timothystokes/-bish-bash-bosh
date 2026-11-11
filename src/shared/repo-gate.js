import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reduce a git remote URL (ssh, scp-style, https) to `host/owner/repo`.
export function normalizeRepoId(url) {
  let s = url.trim();
  s = s.replace(/^[a-z+]+:\/\//i, '');
  s = s.replace(/^[^@/]*@/, '');
  s = s.replace(/^([^/:]+):(?!\d+\/)/, '$1/');
  s = s.replace(/^([^/:]+):\d+\//, '$1/');
  s = s.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return s.toLowerCase();
}

function real(p) {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

// Identify the bish-bash-bosh checkout this code runs from.
export function harnessIdentity(rootDir) {
  const root = real(rootDir ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  let remotes = [];
  try {
    const names = execFileSync('git', ['-C', root, 'remote'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .filter(Boolean);
    remotes = names.map((n) =>
      execFileSync('git', ['-C', root, 'remote', 'get-url', n], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  } catch {
    // not a git checkout: path comparison still applies
  }
  return { root, remotes };
}

// Repo gate: refuse when the target repo is bish-bash-bosh itself.
export function checkRepoGate(target, self = harnessIdentity()) {
  if (typeof target !== 'string' || target.trim() === '') {
    return { ok: false, reason: 'target repo is empty' };
  }
  const selfRoot = real(self.root);
  const selfIds = new Set(self.remotes.map(normalizeRepoId));
  if (selfIds.has(normalizeRepoId(target))) {
    return { ok: false, reason: 'target repo is bish-bash-bosh itself (remote match)' };
  }
  if (isAbsolute(target) || target.startsWith('.')) {
    const rel = relative(selfRoot, real(target));
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      return { ok: false, reason: 'target repo is bish-bash-bosh itself (path match)' };
    }
  }
  return { ok: true };
}
