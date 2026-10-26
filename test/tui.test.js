import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { writeIterationRecord } from '../src/run-record.js';
import { createLocalStatusSource } from '../src/status.js';
import { renderFrame, createTui, runTui } from '../src/tui.js';
import { main } from '../src/cli.js';

const budgets = { maxTokens: 1000, maxCostUsd: 2, maxWallClockSeconds: 100, maxIterations: 5 };

/** @param {string} transcript */
const rec = (transcript) => ({
  status: /** @type {'ok'} */ ('ok'),
  usage: { tokens: 100, cost: 0.5, seconds: 10 },
  changedFiles: [],
  gates: [],
  prompt: 'p',
  transcript,
  diff: '',
  test: {},
});

function makeRun() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-tui-'));
  writeIterationRecord(dir, 'r1', 1, rec('old line'));
  writeIterationRecord(dir, 'r1', 2, rec('l1\nl2\nl3\nl4'));
  return dir;
}

function setup() {
  const dir = makeRun();
  const controlFile = join(dir, 'control.json');
  const tui = createTui({ source: createLocalStatusSource(dir), runId: 'r1', budgets, controlFile, tailLines: 3 });
  return { dir, controlFile, tui };
}

test('local status source tails the latest transcript', () => {
  const src = createLocalStatusSource(makeRun());
  assert.deepEqual(src.tail('r1', 2), ['l3', 'l4']);
  assert.deepEqual(src.tail('none', 2), []);
});

test('renderFrame shows cost meter vs budget, control state, log tail and keys', () => {
  const { tui } = setup();
  const f = tui.frame();
  assert.match(f, /r1/);
  assert.match(f, /cost\s+\$1\.00 \/ \$2\.00/);
  assert.match(f, /iterations\s+2 \/ 5/);
  assert.match(f, /RUNNING/);
  assert.match(f, /l2\nl3\nl4/);
  assert.doesNotMatch(f, /l1/);
  assert.match(f, /\[p\]ause/);
});

test('renderFrame flags over-budget and bad control file', () => {
  const status = { runId: 'r', iterations: 6, lastStatus: 'ok', totals: { tokens: 0, cost: 3, seconds: 0, iterations: 6 }, budgets, remaining: { tokens: 1000, cost: -1, seconds: 100, iterations: -1 } };
  assert.match(renderFrame({ status, control: { ok: true, paused: false, stop: false }, tail: [], prompt: null }), /OVER BUDGET/);
  assert.match(renderFrame({ status, control: { ok: false, reason: 'invalid control file: x' }, tail: [], prompt: null }), /STOPPED.*invalid control file/);
});

test('keys write control.json: pause, resume, steer, stop (stop needs confirmation)', () => {
  const { tui, controlFile } = setup();
  const read = () => JSON.parse(readFileSync(controlFile, 'utf8'));
  tui.key('p');
  assert.equal(read().paused, true);
  assert.match(tui.frame(), /PAUSED/);
  tui.key('r');
  assert.equal(read().paused, false);
  tui.key('s');
  for (const c of 'fix it') tui.key(c);
  assert.match(tui.frame(), /steer> fix it/);
  tui.key('\x7f');
  tui.key('\r');
  assert.equal(read().steer, 'fix i');
  tui.key('x');
  assert.match(tui.frame(), /confirm stop/);
  tui.key('n');
  assert.equal(read().stop, undefined);
  tui.key('x');
  tui.key('y');
  assert.equal(read().stop, true);
  assert.match(tui.frame(), /STOPPED/);
});

test('steer prompt: empty note writes nothing, escape cancels; q and ctrl-c quit', () => {
  const { tui, controlFile } = setup();
  tui.key('s');
  tui.key('\r');
  assert.equal(tui.done, false);
  tui.key('s');
  tui.key('a');
  tui.key('\x1b');
  assert.doesNotMatch(tui.frame(), /steer>/);
  assert.throws(() => readFileSync(controlFile));
  tui.key('q');
  assert.equal(tui.done, true);
  assert.equal(createTui({ source: createLocalStatusSource(makeRun()), runId: 'r1', budgets, controlFile, tailLines: 3 }).key('\x03'), 'quit');
});

test('a malformed control file is reported, not cleared', () => {
  const { tui, controlFile } = setup();
  writeFileSync(controlFile, '{nope');
  tui.key('p');
  assert.match(tui.frame(), /invalid control file/);
  assert.equal(readFileSync(controlFile, 'utf8'), '{nope');
});

test('runTui draws frames, handles input, and resolves on quit', async () => {
  const dir = makeRun();
  const input = new PassThrough();
  let out = '';
  const output = { write: (/** @type {string} */ s) => ((out += s), true) };
  const done = runTui({ source: createLocalStatusSource(dir), runId: 'r1', budgets, controlFile: join(dir, 'c.json'), input, output, intervalMs: 5 });
  input.write('p');
  await new Promise((r) => setTimeout(r, 30));
  input.write('q');
  await done;
  assert.match(out, /PAUSED/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'c.json'), 'utf8')).paused, true);
});

test('hodgepodge tui requires --control', async () => {
  /** @type {string[]} */
  const errs = [];
  const code = await main(['tui'], { stdout: () => {}, stderr: (/** @type {string} */ s) => errs.push(s) });
  assert.equal(code, 2);
  assert.match(errs.join(''), /--control/);
});
