import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeIterationRecord } from '../src/run-record.js';
import { rebuildPointers } from '../src/pointers.js';

/** @param {string} dir @param {string[]} args */
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();

/** @param {'ok'|'failed'|'gated'|'over-budget'} status @param {number} cost */
const rec = (status, cost) => ({ status, usage: { tokens: 10, cost, seconds: 1 }, changedFiles: [], gates: [], prompt: 'p', transcript: 't', diff: '', test: {} });

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-ptr-'));
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'plan.md'), '- [ ] a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

test('a new run reports head sha, zero iterations and status new', () => {
  const dir = makeRepo();
  const p = rebuildPointers(dir, 'r1', join(dir, 'control.json'));
  assert.deepEqual(p, { sha: git(dir, 'rev-parse', 'HEAD'), iteration: 0, cost: 0, status: 'new', paused: false, stop: false });
});

test('iteration, cost and status come from run records', () => {
  const dir = makeRepo();
  writeIterationRecord(dir, 'r1', 1, rec('ok', 0.5));
  writeIterationRecord(dir, 'r1', 2, rec('failed', 0.25));
  const p = rebuildPointers(dir, 'r1', join(dir, 'control.json'));
  assert.equal(p.iteration, 2);
  assert.equal(p.cost, 0.75);
  assert.equal(p.status, 'failed');
});

test('a fully ticked plan reports done', () => {
  const dir = makeRepo();
  writeIterationRecord(dir, 'r1', 1, rec('ok', 0.1));
  writeFileSync(join(dir, 'plan.md'), '- [x] a\n');
  assert.equal(rebuildPointers(dir, 'r1', join(dir, 'control.json')).status, 'done');
});

test('a gated or over-budget last step is surfaced as is', () => {
  const dir = makeRepo();
  writeIterationRecord(dir, 'r1', 1, rec('gated', 0));
  assert.equal(rebuildPointers(dir, 'r1', join(dir, 'control.json')).status, 'gated');
});

test('paused and stop flags come from the control file', () => {
  const dir = makeRepo();
  const ctl = join(dir, 'control.json');
  writeFileSync(ctl, JSON.stringify({ paused: true }));
  assert.deepEqual([rebuildPointers(dir, 'r1', ctl).paused, rebuildPointers(dir, 'r1', ctl).stop], [true, false]);
  writeFileSync(ctl, JSON.stringify({ stop: true }));
  assert.equal(rebuildPointers(dir, 'r1', ctl).stop, true);
});

test('a malformed control file fails closed as stop', () => {
  const dir = makeRepo();
  const ctl = join(dir, 'control.json');
  writeFileSync(ctl, '{nope');
  assert.equal(rebuildPointers(dir, 'r1', ctl).stop, true);
});

test('a repo without commits yields a null sha', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-ptr-'));
  git(dir, 'init', '-q');
  assert.equal(rebuildPointers(dir, 'r1', join(dir, 'control.json')).sha, null);
});

test('pointers survive a JSON round trip (lambda payload)', () => {
  const dir = makeRepo();
  const p = rebuildPointers(dir, 'r1', join(dir, 'control.json'));
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
});
