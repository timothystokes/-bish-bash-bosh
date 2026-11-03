import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDiagnosis } from '../src/bosh-diagnosis.js';
import { writeIterationRecord } from '../src/bosh-run-record.js';

const full = { rootCause: 'rc', evidence: 'ev', fix: 'fx', test: 'ts', prevention: 'pv' };

test('validateDiagnosis requires the five non-empty string fields', () => {
  assert.deepEqual(validateDiagnosis(full), { ok: true, errors: [] });
  const r = validateDiagnosis({ ...full, fix: '', prevention: 3 });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
  assert.equal(validateDiagnosis(null).ok, false);
});

test('writeIterationRecord writes diagnosis.json and rejects an invalid diagnosis', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bish-dg-'));
  const rec = {
    status: /** @type {const} */ ('failed'), usage: { seconds: 1 }, changedFiles: [], gates: [],
    prompt: 'p', transcript: 't', diff: '', test: null,
  };
  assert.throws(() => writeIterationRecord(repo, 'r', 1, { ...rec, diagnosis: /** @type {any} */ ({ rootCause: 'x' }) }), /diagnosis/);
  const dir = writeIterationRecord(repo, 'r', 2, { ...rec, diagnosis: full });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'diagnosis.json'), 'utf8')), full);
  const okDir = writeIterationRecord(repo, 'r', 3, { ...rec, status: 'ok' });
  assert.equal(existsSync(join(okDir, 'diagnosis.json')), false);
});

