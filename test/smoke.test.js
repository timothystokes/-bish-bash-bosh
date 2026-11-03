import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SMOKE_PROMPT, SMOKE_FILE, expectedSmokeOutput, runSmoke } from '../src/smoke.js';
import { createFakeAdapter } from '../src/adapter.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'bish-smoke-'));
const limits = { maxWallClockSeconds: 60 };

const GOOD = `for (let i = 1; i <= 15; i++) console.log(i % 15 === 0 ? 'FizzBuzz' : i % 3 === 0 ? 'Fizz' : i % 5 === 0 ? 'Buzz' : i);\n`;

test('X-11: the prompt names the file, the run command and the exact scope', () => {
  assert.match(SMOKE_PROMPT, new RegExp(SMOKE_FILE.replace('.', '\\.')));
  assert.match(SMOKE_PROMPT, /node fizzbuzz\.js/);
  assert.match(SMOKE_PROMPT, /1 to 15/);
  assert.match(SMOKE_PROMPT, /no other files/i);
});

test('X-11: expected output is FizzBuzz for 1..15', () => {
  assert.equal(expectedSmokeOutput(), '1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz\n');
});

test('X-11: a conforming agent passes the smoke check', async () => {
  const cwd = tmp();
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 'ok', writes: { [SMOKE_FILE]: GOOD } });
  const r = await runSmoke(adapter, { cwd, limits });
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changedFiles, [SMOKE_FILE]);
});

test('X-11: a non-zero agent exit fails the check', async () => {
  const adapter = createFakeAdapter({ exitStatus: 3, transcript: 'x', writes: { [SMOKE_FILE]: GOOD } });
  const r = await runSmoke(adapter, { cwd: tmp(), limits });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /exited 3/);
});

test('X-11: a missing file fails the check', async () => {
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 'x', writes: {} });
  const r = await runSmoke(adapter, { cwd: tmp(), limits });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /fizzbuzz\.js was not created/);
});

test('X-11: wrong output fails the check', async () => {
  const bad = GOOD.replace('FizzBuzz', 'Fizzbuzz');
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 'x', writes: { [SMOKE_FILE]: bad } });
  const r = await runSmoke(adapter, { cwd: tmp(), limits });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /output differs/);
});

test('X-11: a script that crashes fails the check', async () => {
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 'x', writes: { [SMOKE_FILE]: 'throw new Error("boom");\n' } });
  const r = await runSmoke(adapter, { cwd: tmp(), limits });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /exited non-zero/);
});

test('X-11: extra files fail the check', async () => {
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 'x', writes: { [SMOKE_FILE]: GOOD, 'extra.txt': 'x' } });
  const r = await runSmoke(adapter, { cwd: tmp(), limits });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /unexpected files: extra\.txt/);
});

test('X-11: a stale fizzbuzz.js left in cwd is not trusted', async () => {
  const cwd = tmp();
  writeFileSync(join(cwd, SMOKE_FILE), GOOD);
  const adapter = createFakeAdapter({ exitStatus: 0, transcript: 'x', writes: {} });
  const r = await runSmoke(adapter, { cwd, limits });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /fizzbuzz\.js was not created/);
});
