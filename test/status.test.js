import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeIterationRecord } from '../src/run-record.js';
import { createLocalStatusSource, readRunStatus } from '../src/status.js';
import { main } from '../src/cli.js';
import { sandboxOf } from './support/sandbox.js';

const budgets = { maxTokens: 1000, maxCostUsd: 2, maxWallClockSeconds: 100, maxIterations: 5 };

/** @param {'ok'|'failed'} status @param {number} tokens @param {number} cost @param {number} seconds */
const rec = (status, tokens, cost, seconds) => ({
  status,
  usage: { tokens, cost, seconds },
  changedFiles: [],
  gates: [],
  prompt: 'p',
  transcript: 't',
  diff: '',
  test: {},
});

function makeRun() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-status-'));
  writeIterationRecord(dir, 'r1', 1, rec('ok', 100, 0.5, 10));
  writeIterationRecord(dir, 'r1', 2, rec('failed', 200, 0.25, 20));
  return dir;
}

test('readRunStatus totals usage and reports cost vs budget', () => {
  const s = readRunStatus(createLocalStatusSource(makeRun()), 'r1', budgets);
  assert.equal(s.iterations, 2);
  assert.equal(s.lastStatus, 'failed');
  assert.deepEqual(s.totals, { tokens: 300, cost: 0.75, seconds: 30, iterations: 2 });
  assert.deepEqual(s.remaining, { tokens: 700, cost: 1.25, seconds: 70, iterations: 3 });
  assert.equal(s.budgets.maxCostUsd, 2);
});

test('readRunStatus on an unknown run is empty, not an error', () => {
  const s = readRunStatus(createLocalStatusSource(mkdtempSync(join(tmpdir(), 'hodge-status-'))), 'none', budgets);
  assert.equal(s.iterations, 0);
  assert.equal(s.lastStatus, null);
});

test('hodge status prints JSON and includes control state', async () => {
  const dir = makeRun();
  const cfg = join(dir, 'cfg.json');
  writeFileSync(cfg, JSON.stringify({ targetRepo: 'git@example.com:o/t.git', roles: { build: { adapter: 'f', model: 'm' } }, budgets, allowedPaths: ['src/'] }));
  const ctl = join(dir, 'control.json');
  writeFileSync(ctl, JSON.stringify({ paused: true }));
  let out = '';
  const code = await main(['status', '--dir', sandboxOf(cfg, dir), '--run-id', 'r1', '--control', ctl], { stdout: (/** @type {string} */ s) => (out += s), stderr: () => {} });
  assert.equal(code, 0);
  const j = JSON.parse(out);
  assert.equal(j.iterations, 2);
  assert.equal(j.control.paused, true);
});

test('hodge status needs a sandbox (hodge.json)', async () => {
  let e = '';
  const code = await main(['status', '--dir', '/nonexistent/sandbox'], { stdout: () => {}, stderr: (/** @type {string} */ s) => (e += s) });
  assert.equal(code, 2);
  assert.match(e, /hodge\.json/);
});
