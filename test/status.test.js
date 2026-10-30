import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeIterationRecord } from '../src/podge-run-record.js';
import { createLocalStatusSource, readRunStatus } from '../src/status.js';
import { main } from '../src/cli.js';
import { writeProjectConfig, withCwd } from './support/project.js';

const budgets = { maxWallClockSeconds: 100, maxIterations: 5 };

/** @param {'ok'|'failed'} status @param {number} seconds */
const rec = (status, seconds) => ({
  status,
  usage: { seconds },
  changedFiles: [],
  gates: [],
  prompt: 'p',
  transcript: 't',
  diff: '',
  test: {},
});

function makeRun() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-status-'));
  writeIterationRecord(dir, 'r1', 1, rec('ok', 10));
  writeIterationRecord(dir, 'r1', 2, rec('failed', 20));
  return dir;
}

test('readRunStatus totals seconds and iterations vs budget', () => {
  const s = readRunStatus(createLocalStatusSource(makeRun()), 'r1', budgets);
  assert.equal(s.iterations, 2);
  assert.equal(s.lastStatus, 'failed');
  assert.deepEqual(s.totals, { seconds: 30, iterations: 2 });
  assert.deepEqual(s.remaining, { seconds: 70, iterations: 3 });
  assert.equal(s.budgets.maxWallClockSeconds, 100);
});

test('readRunStatus on an unknown run is empty, not an error', () => {
  const s = readRunStatus(createLocalStatusSource(mkdtempSync(join(tmpdir(), 'hodge-status-'))), 'none', budgets);
  assert.equal(s.iterations, 0);
  assert.equal(s.lastStatus, null);
});

test('hodgepodge status prints JSON and includes control state', async () => {
  const dir = makeRun();
  writeProjectConfig(dir, { roles: { build: { adapter: 'f', model: 'm' } }, budgets, allowedPaths: ['src/'] });
  const ctl = join(dir, 'control.json');
  writeFileSync(ctl, JSON.stringify({ paused: true }));
  let out = '';
  const code = await withCwd(dir, () =>
    main(['status', '--run-id', 'r1', '--control', ctl], { stdout: (/** @type {string} */ s) => (out += s), stderr: () => {} }));
  assert.equal(code, 0);
  const j = JSON.parse(out);
  assert.equal(j.iterations, 2);
  assert.equal(j.control.paused, true);
});

test('hodgepodge status needs a project config (.hodgepodge/config.yml)', async () => {
  let e = '';
  const missing = mkdtempSync(join(tmpdir(), 'hodge-status-missing-'));
  const code = await withCwd(missing, () => main(['status'], { stdout: () => {}, stderr: (/** @type {string} */ s) => (e += s) }));
  assert.equal(code, 2);
  assert.match(e, /config\.yml/);
});
