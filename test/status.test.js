import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeIterationRecord } from '../src/bosh-run-record.js';
import { createLocalStatusSource, readRunStatus } from '../src/status.js';
import { main } from '../src/cli.js';
import { writeProjectConfig, withCwd } from './support/project.js';

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
  const dir = mkdtempSync(join(tmpdir(), 'bish-status-'));
  writeIterationRecord(dir, 'r1', 1, rec('ok', 10));
  writeIterationRecord(dir, 'r1', 2, rec('failed', 20));
  return dir;
}

test('readRunStatus totals seconds and iterations', () => {
  const s = readRunStatus(createLocalStatusSource(makeRun()), 'r1');
  assert.equal(s.iterations, 2);
  assert.equal(s.lastStatus, 'failed');
  assert.deepEqual(s.totals, { seconds: 30, iterations: 2 });
});

test('readRunStatus on an unknown run is empty, not an error', () => {
  const s = readRunStatus(createLocalStatusSource(mkdtempSync(join(tmpdir(), 'bish-status-'))), 'none');
  assert.equal(s.iterations, 0);
  assert.equal(s.lastStatus, null);
});

test('bish-bash-bosh status prints a plain summary and includes control state', async () => {
  const dir = makeRun();
  writeProjectConfig(dir, { adapter: 'f', model: 'm' });
  const ctl = join(dir, 'control.json');
  writeFileSync(ctl, JSON.stringify({ paused: true }));
  let out = '';
  const code = await withCwd(dir, () =>
    main(['status', '--run-id', 'r1', '--control', ctl], { stdout: (/** @type {string} */ s) => (out += s), stderr: () => {} }));
  assert.equal(code, 0);
  assert.match(out, /\(2 iterations/);
  assert.match(out, /control: paused/);
});

test('bish-bash-bosh status needs a project config (.bish-bash-bosh/config.yml)', async () => {
  let e = '';
  const missing = mkdtempSync(join(tmpdir(), 'bish-status-missing-'));
  const code = await withCwd(missing, () => main(['status'], { stdout: () => {}, stderr: (/** @type {string} */ s) => (e += s) }));
  assert.equal(code, 2);
  assert.match(e, /config\.yml/);
});
