import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sumRunUsage, checkBudgetGate } from '../src/budget-gate.js';
import { writeIterationRecord } from '../src/run-record.js';

const budgets = { maxTokens: 100, maxCostUsd: 1, maxWallClockSeconds: 60, maxIterations: 3 };

/**
 * @param {string} dir
 * @param {number} n
 * @param {{tokens: number, cost: number, seconds?: number}} usage
 */
const rec = (dir, n, usage) =>
  writeIterationRecord(dir, 'r1', n, {
    status: 'ok', usage, changedFiles: [], gates: [], prompt: 'p', transcript: 't', diff: '', test: {},
  });

test('sumRunUsage of an empty run is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-budget-'));
  assert.deepEqual(sumRunUsage(dir, 'r1'), { tokens: 0, cost: 0, seconds: 0, iterations: 0 });
});

test('sumRunUsage sums records of one run only; seconds default to 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-budget-'));
  rec(dir, 1, { tokens: 10, cost: 0.25, seconds: 5 });
  rec(dir, 2, { tokens: 20, cost: 0.5 });
  writeIterationRecord(dir, 'other', 1, {
    status: 'ok', usage: { tokens: 99, cost: 9 }, changedFiles: [], gates: [], prompt: '', transcript: '', diff: '', test: {},
  });
  assert.deepEqual(sumRunUsage(dir, 'r1'), { tokens: 30, cost: 0.75, seconds: 5, iterations: 2 });
});

test('gate passes under every cap and reports remaining budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-budget-'));
  rec(dir, 1, { tokens: 10, cost: 0.25, seconds: 5 });
  const g = checkBudgetGate(dir, 'r1', budgets);
  assert.equal(g.ok, true);
  assert.deepEqual(g.remaining, { tokens: 90, cost: 0.75, seconds: 55, iterations: 2 });
});

for (const [name, usage, re] of /** @type {const} */ ([
  ['tokens', { tokens: 100, cost: 0 }, /tokens/],
  ['cost', { tokens: 1, cost: 1 }, /cost/],
  ['wall-clock', { tokens: 1, cost: 0, seconds: 60 }, /wall-clock/],
])) {
  test(`gate refuses when ${name} is exhausted`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'hodge-budget-'));
    rec(dir, 1, usage);
    const g = checkBudgetGate(dir, 'r1', budgets);
    assert.equal(g.ok, false);
    assert.match(String(g.reason), re);
  });
}

test('gate refuses when the iteration cap is reached', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-budget-'));
  for (const n of [1, 2, 3]) rec(dir, n, { tokens: 1, cost: 0 });
  const g = checkBudgetGate(dir, 'r1', budgets);
  assert.equal(g.ok, false);
  assert.match(String(g.reason), /iteration/);
});

test('sumRunUsage counts interview usage without counting it as an iteration', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'hodge-budget-'));
  rec(dir, 1, { tokens: 10, cost: 0.25, seconds: 5 });
  mkdirSync(join(dir, 'runs', 'r1', 'interview'), { recursive: true });
  writeFileSync(
    join(dir, 'runs', 'r1', 'interview', 'record.json'),
    JSON.stringify({ status: 'ok', usage: { tokens: 40, cost: 0.5, seconds: 7 } }),
  );
  assert.deepEqual(sumRunUsage(dir, 'r1'), { tokens: 50, cost: 0.75, seconds: 12, iterations: 1 });
  assert.equal(checkBudgetGate(dir, 'r1', budgets).remaining.tokens, 50);
});
