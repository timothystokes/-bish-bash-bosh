import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sumRunUsage } from '../src/run-usage.js';
import { writeIterationRecord } from '../src/bosh-run-record.js';

/**
 * @param {string} dir
 * @param {number} n
 * @param {number} seconds
 */
const rec = (dir, n, seconds) =>
  writeIterationRecord(dir, 'r1', n, {
    status: 'ok', usage: { seconds }, changedFiles: [], gates: [], prompt: 'p', transcript: 't', diff: '', test: {},
  });

test('sumRunUsage of an empty run is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bish-usage-'));
  assert.deepEqual(sumRunUsage(dir, 'r1'), { seconds: 0, iterations: 0 });
});

test('sumRunUsage sums records of one run only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bish-usage-'));
  rec(dir, 1, 5);
  rec(dir, 2, 2);
  writeIterationRecord(dir, 'other', 1, {
    status: 'ok', usage: { seconds: 99 }, changedFiles: [], gates: [], prompt: '', transcript: '', diff: '', test: {},
  });
  assert.deepEqual(sumRunUsage(dir, 'r1'), { seconds: 7, iterations: 2 });
});

test('sumRunUsage counts interview seconds without counting it as an iteration', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'bish-usage-'));
  rec(dir, 1, 5);
  mkdirSync(join(dir, '.bish-bash-bosh', 'runs', 'r1', 'interview'), { recursive: true });
  writeFileSync(
    join(dir, '.bish-bash-bosh', 'runs', 'r1', 'interview', 'record.json'),
    JSON.stringify({ status: 'ok', usage: { seconds: 7 } }),
  );
  assert.deepEqual(sumRunUsage(dir, 'r1'), { seconds: 12, iterations: 1 });
});
