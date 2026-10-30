import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDiagnosis, parseDiagnosis, diagnose } from '../src/podge-diagnosis.js';
import { writeIterationRecord, iterationDir } from '../src/podge-run-record.js';
import { runStep } from '../src/podge-step.js';
import { createFakeAdapter } from '../src/adapter.js';

const full = { rootCause: 'rc', evidence: 'ev', fix: 'fx', test: 'ts', prevention: 'pv' };
const block = (/** @type {unknown} */ o) => `text\n\`\`\`diagnosis\n${JSON.stringify(o)}\n\`\`\`\n`;

test('validateDiagnosis requires the five non-empty string fields', () => {
  assert.deepEqual(validateDiagnosis(full), { ok: true, errors: [] });
  const r = validateDiagnosis({ ...full, fix: '', prevention: 3 });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
  assert.equal(validateDiagnosis(null).ok, false);
});

test('parseDiagnosis reads the last fenced diagnosis block; invalid or absent gives null', () => {
  assert.deepEqual(parseDiagnosis(block({ ...full, rootCause: 'old' }) + block(full)), full);
  assert.equal(parseDiagnosis('no block'), null);
  assert.equal(parseDiagnosis(block({ rootCause: 'only' })), null);
  assert.equal(parseDiagnosis('```diagnosis\n{bad json\n```'), null);
});

test('diagnose returns null for ok steps', () => {
  assert.equal(diagnose({ status: 'ok', gates: [], transcript: '' }), null);
});

test('diagnose names the first failing gate with its detail', () => {
  const d = diagnose({
    status: 'failed',
    gates: [{ name: 'repo', ok: true }, { name: 'scope', ok: false, detail: 'touched docs/x.md' }],
    transcript: '',
  });
  assert.ok(d);
  assert.match(d.rootCause, /scope/);
  assert.match(d.evidence, /touched docs\/x\.md/);
  assert.equal(validateDiagnosis(d).ok, true);
});

test('diagnose covers non-gate failures and agent-reported fields override defaults', () => {
  const crash = diagnose({ status: 'failed', gates: [{ name: 'repo', ok: true }], transcript: 'x' });
  assert.ok(crash);
  assert.match(crash.rootCause, /agent/i);
  const merged = diagnose({
    status: 'failed',
    gates: [{ name: 'tests', ok: false, detail: 'red' }],
    transcript: block({ ...full, rootCause: 'agent view' }),
  });
  assert.ok(merged);
  assert.equal(merged.rootCause, 'agent view');
  assert.equal(merged.fix, 'fx');
});

test('writeIterationRecord writes diagnosis.json and rejects an invalid diagnosis', () => {
  const repo = mkdtempSync(join(tmpdir(), 'hodge-dg-'));
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

test('runStep: a gated failure records diagnosis.json and returns its root cause as reason', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-dgstep-'));
  const git = (/** @type {string[]} */ ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@e.com'); git('config', 'user.name', 'T');
  mkdirSync(join(dir, 'specs'));
  writeFileSync(join(dir, 'specs', 'a.md'), '# A\n');
  writeFileSync(join(dir, 'plan.md'), '# plan\n');
  git('add', '-A'); git('commit', '-qm', 'init');
  const res = await runStep({
    config: {
      roles: { build: { adapter: 'x', model: 'y' } },
      allowedPaths: ['src/'],
    },
    repoDir: dir, runId: 'r1',
    adapter: createFakeAdapter({ exitStatus: 0, transcript: 'ok', writes: { 'other/x.js': 'x\n' } }),
    testCommand: ['node', '-e', 'process.exit(0)'],
    identity: { root: '/nonexistent/hodgepodge', remotes: [] },
  });
  assert.equal(res.status, 'failed');
  assert.match(String(res.reason), /scope/);
  const d = JSON.parse(readFileSync(join(iterationDir(dir, 'r1', 1), 'diagnosis.json'), 'utf8'));
  assert.equal(validateDiagnosis(d).ok, true);
  assert.match(d.rootCause, /scope/);
});
