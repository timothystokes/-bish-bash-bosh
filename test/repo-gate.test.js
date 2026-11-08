import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRepoGate, normalizeRepoId } from '../src/repo-gate.js';

const self = {
  root: '/work/bish-bash-bosh',
  remotes: ['git@github.com:timothystokes/bish-bash-bosh.git'],
};

test('normalizeRepoId unifies ssh, https, case and .git suffix', () => {
  const ids = [
    'git@github.com:TimothyStokes/bish-bash-bosh.git',
    'https://github.com/timothystokes/bish-bash-bosh',
    'https://github.com/timothystokes/bish-bash-bosh.git/',
    'ssh://git@github.com/timothystokes/bish-bash-bosh.git',
    'https://user:tok@github.com/timothystokes/bish-bash-bosh.git',
  ].map(normalizeRepoId);
  assert.equal(new Set(ids).size, 1);
  assert.equal(ids[0], 'github.com/timothystokes/bish-bash-bosh');
});

test('refuses a target whose remote URL matches bish-bash-bosh', () => {
  for (const t of [
    'git@github.com:timothystokes/bish-bash-bosh.git',
    'https://github.com/timothystokes/bish-bash-bosh',
  ]) {
    const r = checkRepoGate(t, self);
    assert.equal(r.ok, false, t);
    assert.match(r.reason, /bish-bash-bosh/);
  }
});

test('refuses a target path equal to or inside bish-bash-bosh root', () => {
  assert.equal(checkRepoGate('/work/bish-bash-bosh', self).ok, false);
  assert.equal(checkRepoGate('/work/bish-bash-bosh/sub/dir', self).ok, false);
  assert.equal(checkRepoGate('/work/bish-bash-bosh/../bish-bash-bosh/x', self).ok, false);
});

test('refuses a symlink that resolves into bish-bash-bosh', () => {
  const base = mkdtempSync(join(tmpdir(), 'gate-'));
  const root = join(base, 'bish');
  mkdirSync(root);
  const link = join(base, 'link');
  symlinkSync(root, link);
  assert.equal(checkRepoGate(link, { root, remotes: [] }).ok, false);
});

test('allows an unrelated repo url and path', () => {
  assert.deepEqual(checkRepoGate('git@example.com:org/delivery.git', self), { ok: true });
  assert.deepEqual(checkRepoGate('/work/bish-bash-bosh-delivery', self), { ok: true });
  assert.deepEqual(checkRepoGate('/work/other', self), { ok: true });
});

test('refuses empty target', () => {
  assert.equal(checkRepoGate('', self).ok, false);
});

test('harnessIdentity on a non-git root is silent on stderr', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync: mk } = await import('node:fs');
  const dir = mk(join(tmpdir(), 'bish-nogit-'));
  const gate = new URL('../src/repo-gate.js', import.meta.url).href;
  const code = `import(${JSON.stringify(gate)}).then(m => console.log(JSON.stringify(m.harnessIdentity(${JSON.stringify(dir)}))))`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.deepEqual(JSON.parse(r.stdout).remotes, []);
});
