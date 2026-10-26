import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintSpecs } from '../src/spec-lint.js';
import { parseTestPlan } from '../src/test-plan-gate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (/** @type {string} */ p) => readFileSync(join(root, 'templates', p), 'utf8');

/** Instantiates the templates the way interview mode will: a spec and a plan mapping it. */
function instantiate() {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-'));
  mkdirSync(join(dir, 'specs'));
  mkdirSync(join(dir, 'tests'));
  writeFileSync(join(dir, 'specs', 'example.md'), read('spec.md'));
  writeFileSync(join(dir, 'tests', 'PLAN.md'), read('tests-PLAN.md'));
  return dir;
}

test('instantiated templates pass spec-lint', () => {
  assert.deepEqual(lintSpecs(instantiate()), { ok: true, problems: [] });
});

test('spec template has a Spec title and required sections', () => {
  const t = read('spec.md');
  assert.match(t, /^# Spec: \S/);
  for (const h of ['## Purpose', '## Requirements', '## Examples', '## Dimensions', '## Out of scope']) assert.ok(t.includes(h), h);
});

test('test-plan template maps the example spec to a test', () => {
  const m = parseTestPlan(read('tests-PLAN.md'));
  assert.ok((m.get('specs/example.md') ?? []).length > 0);
  assert.ok((m.get('R-example-1') ?? []).length > 0);
});

test('spec template declares Implementation and an ID-prefixed requirement', () => {
  const t = read('spec.md');
  assert.match(t, /^Implementation: none$/m);
  assert.match(t, /^- R-example-1: /m);
});

test('spec template carries the Formats section and Out of scope bullet', () => {
  const t = read('spec.md');
  assert.match(t, /^## Formats$/m);
  assert.match(t, /^- <format>: <path>|`- <format>: <path>`/m);
  assert.match(t, /^## Out of scope\n- \S/m);
});

test('toy seed passes spec-lint and every requirement ID is in a test name', () => {
  assert.deepEqual(lintSpecs(join(root, 'templates', 'toy')), { ok: true, problems: [] });
  const spec = read('toy/specs/add.md');
  const ids = [...spec.matchAll(/^- (R-add-\d+):/gm)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  const tests = read('toy/tests/add.test.js');
  for (const id of ids) assert.match(tests, new RegExp(`test\\('[^']*${id}\\b`), id);
});

test('objective PHASES names every spec template section', () => {
  const t = read('objective/PHASES.md');
  for (const s of ['Implementation:', 'Requirements', 'Dimensions', 'Formats', 'Out of scope']) assert.ok(t.includes(s), s);
});
