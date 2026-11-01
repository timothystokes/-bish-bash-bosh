import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, parseStepArgs } from '../src/cli.js';
import { resolveAdapter } from '../src/adapters/index.js';
import { createFakeAdapter } from '../src/adapter.js';

const cfg = (/** @type {string} */ adapter) => ({
  adapter,
  model: 'm',
});

/** @param {string[]} chunks */
const capture = (chunks) => (/** @type {string} */ s) => { chunks.push(s); };

test('parseStepArgs reads flags and applies defaults', () => {
  assert.deepEqual(parseStepArgs([]), { ok: true, runId: 'default' });
  assert.deepEqual(parseStepArgs(['--run-id', 'x1']), { ok: true, runId: 'x1' });
});

test('parseStepArgs rejects missing values and unknown flags', () => {
  assert.equal(parseStepArgs(['--run-id']).ok, false);
  assert.equal(parseStepArgs(['--run-id', 'x', '--bogus']).ok, false);
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
  const { debugAdapter } = await import('../src/cli-lib.js');
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

test('hodgepodge control writes pause/resume/steer/stop to the control file', async () => {
  const { readFileSync } = await import('node:fs');
  const f = join(mkdtempSync(join(tmpdir(), 'hodge-ctl-')), 'control.json');
  const run = async (/** @type {string[]} */ ...a) => {
    const o = /** @type {string[]} */ ([]);
    const e = /** @type {string[]} */ ([]);
    const code = await main(['control', '--file', f, ...a], { stdout: capture(o), stderr: capture(e) });
    return { code, o: o.join(''), e: e.join('') };
  };
  assert.equal((await run('pause')).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { paused: true });
  assert.equal((await run('steer', 'try', 'X')).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { paused: true, steer: 'try X' });
  assert.equal((await run('resume')).code, 0);
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).paused, false);
  const s = await run('stop');
  assert.equal(s.code, 0);
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).stop, true);
  assert.equal(s.o, 'control updated\n');
});

test('hodgepodge control rejects bad usage', async () => {
  const e = /** @type {string[]} */ ([]);
  assert.equal(await main(['control', 'pause'], { stderr: capture(e) }), 2);
  assert.equal(await main(['control', '--file', '/tmp/x.json', 'bogus'], { stderr: capture(e) }), 2);
  assert.equal(await main(['control', '--file', '/tmp/x.json', 'steer'], { stderr: capture(e) }), 2);
  assert.equal(await main(['control', '--file', '/tmp/x.json'], { stderr: capture(e) }), 2);
});

