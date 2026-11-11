import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStepArgs } from '../../src/cli/cli.js';
import { resolveAdapter } from '../../src/adapters/index.js';
import { createFakeAdapter } from '../../src/adapters/adapter.js';

const cfg = (/** @type {string} */ adapter) => ({
  adapter,
  model: 'm',
});

/** @param {string[]} chunks */
const capture = (chunks) => (/** @type {string} */ s) => { chunks.push(s); };

test('parseStepArgs takes no flags and applies defaults', () => {
  assert.deepEqual(parseStepArgs([]), { ok: true, runId: 'default' });
});

test('parseStepArgs rejects any unknown flag', () => {
  assert.equal(parseStepArgs(['--control', 'x']).ok, false);
  assert.equal(parseStepArgs(['--bogus', 'x']).ok, false);
});

test('resolveAdapter maps the configured adapter id through the registry', () => {
  const fake = createFakeAdapter({ exitStatus: 0, transcript: '', writes: {} });
  const a = resolveAdapter(cfg('f'), { f: () => fake });
  assert.equal(a, fake);
});

test('resolveAdapter passes the configured model to the factory', () => {
  /** @type {string | undefined} */
  let seen;
  resolveAdapter(cfg('f'), { f: ({ model }) => { seen = model; return /** @type {any} */ ({}); } });
  assert.equal(seen, 'm');
});

test('resolveAdapter throws on an unknown adapter id', () => {
  assert.throws(() => resolveAdapter(cfg('nope'), {}), /unknown adapter 'nope'/);
});

test('debugAdapter wraps run() with prompt/exit/transcript logging when debug is on, and is a pass-through otherwise', async () => {
  const { debugAdapter } = await import('../../src/cli/cli-lib.js');
  const inner = {
    run: async (req) => {
      req.onOutput?.('stdout', 'building...');
      return { exitStatus: 0, changedFiles: ['a.js'], transcript: 'done' };
    },
  };
  const out = /** @type {string[]} */ ([]);
  const wrapped = debugAdapter(inner, 'build', true, capture(out));
  await wrapped.run({ prompt: 'do the thing', cwd: '/tmp/x', limits: { seconds: 5 } });
  const text = out.join('');
  assert.match(text, /\[debug\] build: agent start \(cwd \/tmp\/x, seconds=5\)/);
  assert.match(text, /\[debug\] build: prompt begin\ndo the thing\n\[debug\] build: prompt end/);
  assert.match(text, /building\.\.\./);
  assert.match(text, /\[debug\] build: exit 0, changed: a\.js/);
  assert.match(text, /\[debug\] build: transcript begin\ndone\n\[debug\] build: transcript end/);

  assert.equal(debugAdapter(inner, 'build', false, capture(out)), inner, 'debug off: the adapter is returned unwrapped');
});
