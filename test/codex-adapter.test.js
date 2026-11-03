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

test('buildCodexArgs resumes a session instead of starting a new one, when given a resumeId', () => {
  const a = buildCodexArgs({ prompt: 'do it', resumeId: 't1' });
  assert.deepEqual(a.slice(0, 3), ['exec', 'resume', 't1']);
  assert.equal(a.at(-1), 'do it');
});

test('parseCodexOutput joins agent messages and ignores turn usage', () => {
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
  assert.equal(p.transcript, 'One.\nTwo.');
});

test('parseCodexOutput tolerates junk lines', () => {
  assert.equal(parseCodexOutput('not json').transcript, 'not json');
});

test('parseCodexOutput extracts the session id a later call can resume with', () => {
  const out = [{ type: 'thread.started', thread_id: 'abc' }, { type: 'item.completed', item: { type: 'agent_message', text: 'hi' } }]
    .map((e) => JSON.stringify(e))
    .join('\n');
  assert.equal(parseCodexOutput(out).threadId, 'abc');
});

test('a caller that never passes session gets no session back (unchanged behaviour)', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bish-cx-'));
  try {
    const r = await make({ exitStatus: 0, transcript: 'ok', writes: {} }).run({ prompt: 'p', cwd, limits: {} });
    assert.equal('session' in r, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a caller opting into session tracking gets the thread id codex assigned, then resumes it', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bish-cx-'));
  try {
    const adapter = make({ exitStatus: 0, transcript: 'ok', writes: {} });
    const first = await adapter.run({ prompt: 'p', cwd, limits: {}, session: undefined });
    assert.equal(first.session, 't1'); // fake-codex.js always emits thread_id "t1"
    const second = await adapter.run({ prompt: 'p2', cwd, limits: {}, session: first.session });
    assert.equal(second.session, 't1');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});


test('wall-clock limit kills the agent and reports non-zero exit', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bish-cx-'));
  try {
    const adapter = make(/** @type {any} */ ({ exitStatus: 0, transcript: '', writes: {}, hang: true }));
    const r = await adapter.run({ prompt: 'p', cwd, limits: { maxWallClockSeconds: 0.3 } });
    assert.equal(r.exitStatus, 124);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('missing command yields exit 127, not a throw', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bish-cx-'));
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
