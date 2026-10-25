import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexAdapter, buildCodexArgs, parseCodexOutput } from '../src/adapters/codex.js';
import { defaultRegistry } from '../src/adapters/index.js';
import { adapterContract } from './helpers/adapter-contract.js';

const fake = fileURLToPath(new URL('./fixtures/fake-codex.js', import.meta.url));

/** @param {import('../src/adapter.js').FakeFixture} fixture */
const make = (fixture) =>
  createCodexAdapter({
    model: 'm',
    command: process.execPath,
    prefixArgs: [fake],
    env: { FAKE_AGENT_FIXTURE: JSON.stringify(fixture) },
  });

adapterContract('codex adapter', make);

test('buildCodexArgs is non-interactive exec with JSONL, model and prompt last', () => {
  const a = buildCodexArgs({ prompt: 'do it', model: 'x' });
  assert.equal(a[0], 'exec');
  assert.ok(a.includes('--json'));
  assert.equal(a[a.indexOf('--model') + 1], 'x');
  assert.ok(a.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.equal(a.at(-1), 'do it');
});

test('parseCodexOutput sums turn usage (cache excluded) and joins agent messages', () => {
  const out = [
    { type: 'thread.started', thread_id: 't' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'One.' } },
    { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 999, output_tokens: 5 } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Two.' } },
    { type: 'turn.completed', usage: { input_tokens: 3, cached_input_tokens: 0, output_tokens: 2 } },
  ]
    .map((e) => JSON.stringify(e))
    .join('\n');
  const p = parseCodexOutput(out);
  assert.deepEqual(p.usage, { tokens: 20, cost: 0 });
  assert.equal(p.transcript, 'One.\nTwo.');
});

test('parseCodexOutput tolerates junk lines', () => {
  assert.deepEqual(parseCodexOutput('not json').usage, { tokens: 0, cost: 0 });
  assert.equal(parseCodexOutput('not json').transcript, 'not json');
});


test('wall-clock limit kills the agent and reports non-zero exit', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hodge-cx-'));
  try {
    const adapter = make(/** @type {any} */ ({ exitStatus: 0, transcript: '', usage: { tokens: 0, cost: 0 }, writes: {}, hang: true }));
    const r = await adapter.run({ prompt: 'p', cwd, limits: { maxWallClockSeconds: 0.3 } });
    assert.equal(r.exitStatus, 124);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('missing command yields exit 127, not a throw', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hodge-cx-'));
  try {
    const r = await createCodexAdapter({ model: 'm', command: 'definitely-not-a-real-binary-xyz' }).run({ prompt: 'p', cwd, limits: {} });
    assert.equal(r.exitStatus, 127);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('registered in defaultRegistry as codex', () => {
  assert.equal(typeof defaultRegistry['codex'], 'function');
});
