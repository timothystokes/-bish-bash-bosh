import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCopilotAdapter, buildCopilotArgs, parseCopilotOutput } from '../src/adapters/copilot.js';
import { adapterContract } from './helpers/adapter-contract.js';

const fake = fileURLToPath(new URL('./fixtures/fake-copilot.js', import.meta.url));

/** @param {import('../src/adapter.js').FakeFixture} fixture */
const make = (fixture) =>
  createCopilotAdapter({
    model: 'm',
    command: process.execPath,
    prefixArgs: [fake],
    env: { FAKE_AGENT_FIXTURE: JSON.stringify(fixture) },
  });

adapterContract('copilot adapter', make);

test('buildCopilotArgs is non-interactive and passes model', () => {
  const a = buildCopilotArgs({ prompt: 'do it', model: 'x' });
  assert.deepEqual(a.slice(0, 2), ['-p', 'do it']);
  assert.ok(a.includes('--output-format') && a.includes('json'));
  assert.equal(a[a.indexOf('--model') + 1], 'x');
  assert.ok(a.includes('--no-ask-user'));
});

test('parseCopilotOutput sums usage, joins messages, tolerates junk lines', () => {
  const out = [
    'not json',
    JSON.stringify({ type: 'assistant.message', data: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant.usage', data: { inputTokens: 10, outputTokens: 5, cost: 0.2 } }),
    JSON.stringify({ type: 'assistant.usage', data: { inputTokens: 1, outputTokens: 1 } }),
  ].join('\n');
  const p = parseCopilotOutput(out);
  assert.deepEqual(p.usage, { tokens: 17, cost: 0.2 });
  assert.match(p.transcript, /hi/);
});

test('parseCopilotOutput reads the real session.usage_checkpoint shape (last checkpoint wins)', () => {
  const cp = (/** @type {number} */ i, /** @type {number} */ o) =>
    JSON.stringify({
      type: 'session.usage_checkpoint',
      data: { accountingSnapshot: { modelMetrics: { m1: { usage: { inputTokens: i, outputTokens: o, cacheReadTokens: 999 } }, m2: { usage: { inputTokens: 1, outputTokens: 2 } } } } },
    });
  const out = [cp(10, 1), JSON.stringify({ type: 'assistant.message', data: { content: 'Done.' } }), cp(51531, 90)].join('\n');
  const p = parseCopilotOutput(out);
  assert.deepEqual(p.usage, { tokens: 51531 + 90 + 3, cost: 0 });
  assert.match(p.transcript, /Done\./);
});

test('wall-clock limit kills the agent and reports non-zero exit', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hodge-cop-'));
  try {
    const adapter = make(/** @type {any} */ ({ exitStatus: 0, transcript: '', usage: { tokens: 0, cost: 0 }, writes: {}, hang: true }));
    const r = await adapter.run({ prompt: 'p', cwd, limits: { maxWallClockSeconds: 0.3 } });
    assert.notEqual(r.exitStatus, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('missing command yields a failed result, not a throw', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hodge-cop-'));
  try {
    const adapter = createCopilotAdapter({ model: 'm', command: 'definitely-not-a-real-binary-xyz' });
    const r = await adapter.run({ prompt: 'p', cwd, limits: {} });
    assert.notEqual(r.exitStatus, 0);
    assert.deepEqual(r.changedFiles, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
