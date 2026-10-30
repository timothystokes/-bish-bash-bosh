import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sumRunUsage, checkBudgetGate } from '../src/budget-gate.js';
import { writeIterationRecord } from '../src/podge-run-record.js';

const budgets = { maxWallClockSeconds: 60, maxIterations: 3 };

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
  const dir = mkdtempSync(join(tmpdir(), 'hodge-budget-'));
  assert.deepEqual(sumRunUsage(dir, 'r1'), { seconds: 0, iterations: 0 });
});

test('sumRunUsage sums records of one run only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-budget-'));
  rec(dir, 1, 5);
  rec(dir, 2, 2);
  writeIterationRecord(dir, 'other', 1, {
    status: 'ok', usage: { seconds: 99 }, changedFiles: [], gates: [], prompt: '', transcript: '', diff: '', test: {},
  });
  assert.deepEqual(sumRunUsage(dir, 'r1'), { seconds: 7, iterations: 2 });
});

test('gate passes under every cap and reports remaining budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-budget-'));
  rec(dir, 1, 5);
  const g = checkBudgetGate(dir, 'r1', budgets);
  assert.equal(g.ok, true);
  assert.deepEqual(g.remaining, { seconds: 55, iterations: 2 });
});

test('gate refuses when wall-clock is exhausted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-budget-'));
  rec(dir, 1, 60);
  const g = checkBudgetGate(dir, 'r1', budgets);
  assert.equal(g.ok, false);
  assert.match(String(g.reason), /wall-clock/);
});

test('gate refuses when the iteration cap is reached', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-budget-'));
  for (const n of [1, 2, 3]) rec(dir, n, 1);
  const g = checkBudgetGate(dir, 'r1', budgets);
  assert.equal(g.ok, false);
  assert.match(String(g.reason), /iteration/);
});

test('sumRunUsage counts interview seconds without counting it as an iteration', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'hodge-budget-'));
  rec(dir, 1, 5);
  mkdirSync(join(dir, '.hodgepodge', 'runs', 'r1', 'interview'), { recursive: true });
  writeFileSync(
    join(dir, '.hodgepodge', 'runs', 'r1', 'interview', 'record.json'),
    JSON.stringify({ status: 'ok', usage: { seconds: 7 } }),
  );
  assert.deepEqual(sumRunUsage(dir, 'r1'), { seconds: 12, iterations: 1 });
  assert.equal(checkBudgetGate(dir, 'r1', budgets).remaining.seconds, 48);
});
