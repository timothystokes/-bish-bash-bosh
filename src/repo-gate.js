import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{root: string, remotes: string[]}} HarnessIdentity
 * @typedef {{ok: true} | {ok: false, reason: string}} GateResult
 */

/**
 * Reduce a git remote URL (ssh, scp-style, https) to `host/owner/repo`.
 * @param {string} url
 * @returns {string}
 */
export function normalizeRepoId(url) {
  let s = url.trim();
  s = s.replace(/^[a-z+]+:\/\//i, '');
  s = s.replace(/^[^@/]*@/, '');
  s = s.replace(/^([^/:]+):(?!\d+\/)/, '$1/');
  s = s.replace(/^([^/:]+):\d+\//, '$1/');
  s = s.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return s.toLowerCase();
}

/** @param {string} p */
function real(p) {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/**
 * Identify the hodgepodge checkout this code runs from.
 * @returns {HarnessIdentity}
 */
export function harnessIdentity() {
  const root = real(join(dirname(fileURLToPath(import.meta.url)), '..'));
  /** @type {string[]} */
  let remotes = [];
  try {
    const names = execFileSync('git', ['-C', root, 'remote'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    remotes = names.map((n) =>
      execFileSync('git', ['-C', root, 'remote', 'get-url', n], { encoding: 'utf8' }).trim(),
    );
  } catch {
    // not a git checkout: path comparison still applies
  }
  return { root, remotes };
}

/**
 * Repo gate: refuse when the target repo is hodgepodge itself.
 * @param {string} target remote URL or local path
 * @param {HarnessIdentity} [self]
 * @returns {GateResult}
 */
export function checkRepoGate(target, self = harnessIdentity()) {
  if (typeof target !== 'string' || target.trim() === '') {
    return { ok: false, reason: 'target repo is empty' };
  }
  const selfRoot = real(self.root);
  const selfIds = new Set(self.remotes.map(normalizeRepoId));
  if (selfIds.has(normalizeRepoId(target))) {
    return { ok: false, reason: 'target repo is hodgepodge itself (remote match)' };
  }
  if (isAbsolute(target) || target.startsWith('.')) {
    const rel = relative(selfRoot, real(target));
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      return { ok: false, reason: 'target repo is hodgepodge itself (path match)' };
    }
  }
  return { ok: true };
}
