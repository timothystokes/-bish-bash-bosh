import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRepoGate, normalizeRepoId } from '../src/repo-gate.js';

const self = {
  root: '/work/hodgepodge',
  remotes: ['git@github.com:ticked-com/ticked-hodgepodge.git'],
};

test('normalizeRepoId unifies ssh, https, case and .git suffix', () => {
  const ids = [
    'git@github.com:Ticked-Com/ticked-hodgepodge.git',
    'https://github.com/ticked-com/ticked-hodgepodge',
    'https://github.com/ticked-com/ticked-hodgepodge.git/',
    'ssh://git@github.com/ticked-com/ticked-hodgepodge.git',
    'https://user:tok@github.com/ticked-com/ticked-hodgepodge.git',
  ].map(normalizeRepoId);
  assert.equal(new Set(ids).size, 1);
  assert.equal(ids[0], 'github.com/ticked-com/ticked-hodgepodge');
});

test('refuses a target whose remote URL matches hodgepodge', () => {
  for (const t of [
    'git@github.com:ticked-com/ticked-hodgepodge.git',
    'https://github.com/ticked-com/ticked-hodgepodge',
  ]) {
    const r = checkRepoGate(t, self);
    assert.equal(r.ok, false, t);
    assert.match(r.reason, /hodgepodge/);
  }
});

test('refuses a target path equal to or inside hodgepodge root', () => {
  assert.equal(checkRepoGate('/work/hodgepodge', self).ok, false);
  assert.equal(checkRepoGate('/work/hodgepodge/sub/dir', self).ok, false);
  assert.equal(checkRepoGate('/work/hodgepodge/../hodgepodge/x', self).ok, false);
});

test('refuses a symlink that resolves into hodgepodge', () => {
  const base = mkdtempSync(join(tmpdir(), 'gate-'));
  const root = join(base, 'hodge');
  mkdirSync(root);
  const link = join(base, 'link');
  symlinkSync(root, link);
  assert.equal(checkRepoGate(link, { root, remotes: [] }).ok, false);
});

test('allows an unrelated repo url and path', () => {
  assert.deepEqual(checkRepoGate('git@example.com:org/delivery.git', self), { ok: true });
  assert.deepEqual(checkRepoGate('/work/hodgepodge-delivery', self), { ok: true });
  assert.deepEqual(checkRepoGate('/work/other', self), { ok: true });
});

test('refuses empty target', () => {
  assert.equal(checkRepoGate('', self).ok, false);
});
