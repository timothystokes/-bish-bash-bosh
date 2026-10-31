import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCopilotAdapter, buildCopilotArgs, parseCopilotOutput, dropEphemeralEvents } from '../src/adapters/copilot.js';
import { adapterContract } from './helpers/adapter-contract.js';

const fake = fileURLToPath(new URL('./fixtures/fake-copilot.js', import.meta.url));

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

test('buildCopilotArgs passes --session-id only when given one', () => {
  assert.ok(!buildCopilotArgs({ prompt: 'p' }).includes('--session-id'));
  const a = buildCopilotArgs({ prompt: 'p', sessionId: 's1' });
  assert.equal(a[a.indexOf('--session-id') + 1], 's1');
});

test('a caller that never passes session gets no session flag and no session back (unchanged behaviour)', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hodge-cop-'));
  try {
    const r = await make({ exitStatus: 0, transcript: 'ok', writes: {} }).run({ prompt: 'p', cwd, limits: {} });
    assert.equal('session' in r, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a caller opting into session tracking gets a generated session id back, then resumes it', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hodge-cop-'));
  try {
    const adapter = make({ exitStatus: 0, transcript: 'ok', writes: {} });
    const first = await adapter.run({ prompt: 'p', cwd, limits: {}, session: undefined });
    assert.match(first.session, /^[0-9a-f-]{36}$/);
    const second = await adapter.run({ prompt: 'p2', cwd, limits: {}, session: first.session });
    assert.equal(second.session, first.session);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('parseCopilotOutput joins assistant messages, keeps junk lines and ignores usage events', () => {
  const out = [
    'not json',
    JSON.stringify({ type: 'assistant.message', data: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant.usage', data: { inputTokens: 10, outputTokens: 5, cost: 0.2 } }),
    JSON.stringify({ type: 'session.usage_checkpoint', data: {} }),
  ].join('\n');
  assert.deepEqual(parseCopilotOutput(out), { transcript: 'not json\nhi' });
});

test('wall-clock limit kills the agent and reports non-zero exit', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hodge-cop-'));
  try {
    const adapter = make(/** @type {any} */ ({ exitStatus: 0, transcript: '', writes: {}, hang: true }));
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

test('dropEphemeralEvents hides ephemeral events across chunk splits and keeps the rest', () => {
  /** @type {string[]} */
  const out = [];
  const f = dropEphemeralEvents((stream, chunk) => out.push(`${stream}:${chunk}`));
  assert.ok(f);
  const noisy = JSON.stringify({ type: 'session.background_tasks_changed', ephemeral: true, data: {} });
  const msg = JSON.stringify({ type: 'assistant.message', data: { content: 'hi' } });
  f.write('stdout', `${noisy}\n${msg.slice(0, 10)}`);
  f.write('stdout', `${msg.slice(10)}\nplain junk\n${noisy}\n`);
  f.write('stderr', 'warn\n');
  f.flush();
  assert.deepEqual(out, [`stdout:${msg}\n`, 'stdout:plain junk\n', 'stderr:warn\n']);
});

test('dropEphemeralEvents drops any ephemeral event, not only session.*, and keeps non-ephemeral ones', () => {
  /** @type {string[]} */
  const out = [];
  const f = dropEphemeralEvents((_s, c) => out.push(c));
  assert.ok(f);
  const delta = JSON.stringify({ type: 'assistant.reasoning_delta', ephemeral: true, data: { deltaContent: 'x' } });
  const session = JSON.stringify({ type: 'session.tools_updated', data: {} });
  f.write('stdout', `${delta}\n${session}\n`);
  f.flush();
  assert.deepEqual(out, [`${session}\n`]);
});

test('dropEphemeralEvents flushes a trailing partial line and passes through when no sink', () => {
  /** @type {string[]} */
  const out = [];
  const f = dropEphemeralEvents((_s, c) => out.push(c));
  assert.ok(f);
  f.write('stdout', 'tail without newline');
  f.flush();
  assert.deepEqual(out, ['tail without newline']);
  assert.equal(dropEphemeralEvents(undefined), undefined);
});
