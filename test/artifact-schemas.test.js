import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import { writeIterationRecord } from '../src/podge-run-record.js';
import { writeDoneReport } from '../src/podge-done.js';

const SCHEMAS = ['config', 'record', 'usage', 'diagnosis', 'done'];

/** @param {string} name */
const load = (name) => JSON.parse(readFileSync(new URL(`../src/${name === 'config' ? 'config.schema.json' : `schemas/${name}.schema.json`}`, import.meta.url), 'utf8'));

const ajv = new Ajv.default({ allErrors: true, strict: true });
const validators = Object.fromEntries(SCHEMAS.map((n) => [n, ajv.compile(load(n))]));

/** @param {string} name @param {unknown} data */
const check = (name, data) => {
  const v = validators[name];
  return { ok: Boolean(v(data)), errors: (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`) };
};

/** @type {Record<string, string>} */
const diagnosis = { rootCause: 'r', evidence: 'e', fix: 'f', test: 't', prevention: 'p' };

test('every artifact schema compiles in strict mode and has an $id', () => {
  for (const n of SCHEMAS) assert.ok(load(n).$id, n);
});

test('config schema accepts a single adapter/model and maxQaCycles', () => {
  const cfg = {
    adapter: 'a',
    model: 'm',
    maxQaCycles: 3,
  };
  assert.equal(check('config', cfg).ok, true);
  const { model, ...noModel } = cfg;
  assert.equal(check('config', noModel).ok, false);
});

test('files written by writeIterationRecord conform (with and without diagnosis)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'hodge-schema-'));
  try {
    const base = { status: 'ok', usage: { seconds: 2 }, changedFiles: ['a.js'], gates: [{ name: 'scope', ok: true }], prompt: 'p', transcript: 't', diff: 'd', test: { exitStatus: 0 } };
    const d1 = writeIterationRecord(repo, 'run1', 1, /** @type {any} */ (base));
    const d2 = writeIterationRecord(repo, 'run1', 2, /** @type {any} */ ({ ...base, status: 'failed', gates: [{ name: 'tests', ok: false, detail: 'x' }], diagnosis }));
    for (const dir of [d1, d2]) {
      for (const [file, schema] of [['record.json', 'record'], ['usage.json', 'usage']]) {
        const r = check(schema, JSON.parse(readFileSync(join(dir, file), 'utf8')));
        assert.equal(r.ok, true, `${file}: ${r.errors}`);
      }
    }
    assert.ok(readdirSync(d1).every((f) => f !== 'diagnosis.json'));
    const r = check('diagnosis', JSON.parse(readFileSync(join(d2, 'diagnosis.json'), 'utf8')));
    assert.equal(r.ok, true, r.errors.join('; '));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('record schema rejects bad status, missing gates and extra keys', () => {
  const rec = { iteration: 1, status: 'ok', changedFiles: [], gates: [] };
  assert.equal(check('record', rec).ok, true);
  assert.equal(check('record', { ...rec, status: 'weird' }).ok, false);
  assert.equal(check('record', { ...rec, iteration: 0 }).ok, false);
  assert.equal(check('record', { ...rec, gates: [{ name: 'x' }] }).ok, false);
  assert.equal(check('record', { ...rec, extra: 1 }).ok, false);
});

test('usage schema rejects negative or missing seconds and the old token/cost keys', () => {
  assert.equal(check('usage', { seconds: 1.5 }).ok, true);
  assert.equal(check('usage', { seconds: -1 }).ok, false);
  assert.equal(check('usage', {}).ok, false);
  assert.equal(check('usage', { seconds: 1, tokens: 1 }).ok, false);
});

test('diagnosis schema requires all five non-blank fields', () => {
  assert.equal(check('diagnosis', diagnosis).ok, true);
  for (const k of Object.keys(diagnosis)) {
    assert.equal(check('diagnosis', { ...diagnosis, [k]: '' }).ok, false, k);
    const { [k]: _omit, ...rest } = diagnosis;
    assert.equal(check('diagnosis', rest).ok, false, k);
  }
});

test('done.json written by writeDoneReport conforms; bad shapes do not', () => {
  const repo = mkdtempSync(join(tmpdir(), 'hodge-schema-'));
  try {
    const report = {
      ok: false,
      suite: { ok: true },
      types: { ok: true },
      requirements: [{ id: 'R-x-1', spec: 'specs/x.md', implementation: 'partial', status: 'unproven', tests: [] }],
      gaps: ['R-x-1: no passing test names it'],
    };
    writeDoneReport(repo, 'run1', report);
    const r = check('done', JSON.parse(readFileSync(join(repo, '.hodgepodge', 'runs', 'run1', 'done.json'), 'utf8')));
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.equal(check('done', { ...report, requirements: [{ ...report.requirements[0], status: 'maybe' }] }).ok, false);
    assert.equal(check('done', { ...report, gaps: 'none' }).ok, false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
