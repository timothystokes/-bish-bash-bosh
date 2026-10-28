import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRunRecord, writeIterationRecord, iterationDir } from '../src/podge-run-record.js';

const record = () => ({
  status: 'ok',
  usage: { seconds: 2.5 },
  changedFiles: ['a.js'],
  gates: [{ name: 'scope', ok: true }],
  prompt: 'do it',
  transcript: 'done',
  diff: 'diff --git a b',
  test: { passed: 3, failed: 0 },
});

const tmp = () => mkdtempSync(join(tmpdir(), 'hodge-rr-'));

test('validateRunRecord accepts a good record', () => {
  assert.deepEqual(validateRunRecord(record()), { ok: true, errors: [] });
});

test('validateRunRecord rejects bad fields', () => {
  const bad = { ...record(), status: 'weird', changedFiles: [1], gates: [{ name: 'x' }], usage: { seconds: -1 } };
  const r = validateRunRecord(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 4);
  assert.match(r.errors.join(), /usage\.seconds/);
  assert.equal(validateRunRecord(null).ok, false);
});

test('iterationDir zero-pads the iteration number', () => {
  assert.equal(iterationDir('/r', 'run1', 7), join('/r', 'runs', 'run1', 'iterations', '007'));
});

test('writeIterationRecord writes the spec layout', () => {
  const repo = tmp();
  const dir = writeIterationRecord(repo, 'run1', 1, record());
  assert.equal(dir, iterationDir(repo, 'run1', 1));
  assert.equal(readFileSync(join(dir, 'prompt'), 'utf8'), 'do it');
  assert.equal(readFileSync(join(dir, 'transcript'), 'utf8'), 'done');
  assert.equal(readFileSync(join(dir, 'diff'), 'utf8'), 'diff --git a b');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'test.json'), 'utf8')), { passed: 3, failed: 0 });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'usage.json'), 'utf8')), { seconds: 2.5 });
  const meta = JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8'));
  assert.equal(meta.status, 'ok');
  assert.equal(meta.iteration, 1);
  assert.deepEqual(meta.changedFiles, ['a.js']);
  assert.deepEqual(meta.gates, [{ name: 'scope', ok: true }]);
});

test('writeIterationRecord refuses invalid records and leaves nothing behind', () => {
  const repo = tmp();
  assert.throws(() => writeIterationRecord(repo, 'run1', 1, { ...record(), status: /** @type {any} */ ('nope') }), /status/);
  assert.equal(existsSync(join(repo, 'runs')), false);
});

test('writeIterationRecord refuses to overwrite an existing iteration', () => {
  const repo = tmp();
  writeIterationRecord(repo, 'run1', 1, record());
  assert.throws(() => writeIterationRecord(repo, 'run1', 1, record()), /exists/);
  writeIterationRecord(repo, 'run1', 2, record());
  assert.deepEqual(readdirSync(join(repo, 'runs', 'run1', 'iterations')).sort(), ['001', '002']);
});

test('writeIterationRecord rejects unsafe run ids and iterations', () => {
  const repo = tmp();
  assert.throws(() => writeIterationRecord(repo, '../evil', 1, record()), /runId/);
  assert.throws(() => writeIterationRecord(repo, 'run1', 0, record()), /iteration/);
});
