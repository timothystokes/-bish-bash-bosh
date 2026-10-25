import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeCodeAdapter, buildClaudeArgs, parseClaudeOutput } from '../src/adapters/claude-code.js';
import { defaultRegistry } from '../src/adapters/index.js';
import { adapterContract } from './helpers/adapter-contract.js';

const fake = fileURLToPath(new URL('./fixtures/fake-claude.js', import.meta.url));

/** @param {import('../src/adapter.js').FakeFixture} fixture */
const make = (fixture) =>
  createClaudeCodeAdapter({
    model: 'm',
    command: process.execPath,
    prefixArgs: [fake],
    env: { FAKE_AGENT_FIXTURE: JSON.stringify(fixture) },
  });

adapterContract('claude-code adapter', make);

test('buildClaudeArgs is non-interactive JSON and passes model', () => {
  const a = buildClaudeArgs({ prompt: 'do it', model: 'x' });
  assert.deepEqual(a.slice(0, 2), ['-p', 'do it']);
  assert.equal(a[a.indexOf('--output-format') + 1], 'json');
  assert.equal(a[a.indexOf('--model') + 1], 'x');
  assert.ok(a.includes('--dangerously-skip-permissions'));
});

test('parseClaudeOutput reads result, cost and token usage (cache excluded)', () => {
  const out = JSON.stringify({
    type: 'result',
    result: 'Done.',
    total_cost_usd: 0.25,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 999 },
  });
  const p = parseClaudeOutput(out);
  assert.deepEqual(p.usage, { tokens: 15, cost: 0.25 });
  assert.equal(p.transcript, 'Done.');
});

test('parseClaudeOutput tolerates junk and picks the result entry from an array', () => {
  assert.deepEqual(parseClaudeOutput('not json').usage, { tokens: 0, cost: 0 });
  assert.equal(parseClaudeOutput('not json').transcript, 'not json');
  const arr = JSON.stringify([{ type: 'system' }, { type: 'result', result: 'ok', total_cost_usd: 1, usage: { input_tokens: 1, output_tokens: 1 } }]);
  assert.deepEqual(parseClaudeOutput(arr), { transcript: 'ok', usage: { tokens: 2, cost: 1 } });
});

test('wall-clock limit kills the agent and reports non-zero exit', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hodge-cc-'));
  try {
    const adapter = make(/** @type {any} */ ({ exitStatus: 0, transcript: '', usage: { tokens: 0, cost: 0 }, writes: {}, hang: true }));
    const r = await adapter.run({ prompt: 'p', cwd, limits: { maxWallClockSeconds: 0.3 } });
    assert.equal(r.exitStatus, 124);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('missing command yields exit 127, not a throw', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hodge-cc-'));
  try {
    const r = await createClaudeCodeAdapter({ model: 'm', command: 'definitely-not-a-real-binary-xyz' }).run({ prompt: 'p', cwd, limits: {} });
    assert.equal(r.exitStatus, 127);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('registered in defaultRegistry as claude-code', () => {
  assert.equal(typeof defaultRegistry['claude-code'], 'function');
});
