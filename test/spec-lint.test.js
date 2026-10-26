import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintSpecs } from '../src/spec-lint.js';
import { main } from '../src/cli.js';

/** @param {Record<string, string>} files */
function target(files) {
  const dir = mkdtempSync(join(tmpdir(), 'sl-'));
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), c);
  }
  return dir;
}

const GOOD = {
  'specs/a.md': '# Spec: Alpha\n- does a\n',
  'specs/b.md': '# Spec: Beta\n- does b\n',
  'tests/PLAN.md': '| specs/a.md | tests/a.test.js |\n| specs/b.md | tests/b.test.js |\n',
};

test('passes for well-formed, mapped specs', () => {
  assert.deepEqual(lintSpecs(target(GOOD)), { ok: true, problems: [] });
});

test('fails when there is no specs directory or it has no specs', () => {
  assert.equal(lintSpecs(target({ 'tests/PLAN.md': '' })).ok, false);
  assert.equal(lintSpecs(target({ 'specs/README.txt': 'x' })).ok, false);
});

test('fails on an empty spec file', () => {
  const r = lintSpecs(target({ ...GOOD, 'specs/b.md': '  \n\n' }));
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /specs\/b\.md.*empty/);
});

test('fails when the title is not "# Spec: ..."', () => {
  const r = lintSpecs(target({ ...GOOD, 'specs/b.md': '# Beta\n- b\n' }));
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /specs\/b\.md.*# Spec:/);
});

test('fails when a spec holds more than one decision (several top-level titles)', () => {
  const r = lintSpecs(target({ ...GOOD, 'specs/b.md': '# Spec: Beta\n- b\n# Spec: Gamma\n- g\n' }));
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /specs\/b\.md.*one decision/);
});

test('ignores "#" lines inside code fences when counting titles', () => {
  const r = lintSpecs(target({ ...GOOD, 'specs/b.md': '# Spec: Beta\n```sh\n# comment\n```\n' }));
  assert.deepEqual(r, { ok: true, problems: [] });
});

test('fails on duplicate titles across specs', () => {
  const r = lintSpecs(target({ ...GOOD, 'specs/b.md': '# Spec: alpha\n- b\n' }));
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /duplicate title.*specs\/a\.md.*specs\/b\.md/);
});

test('fails when a spec is not mapped in tests/PLAN.md', () => {
  const r = lintSpecs(target({ ...GOOD, 'tests/PLAN.md': '| specs/a.md | tests/a.test.js |\n' }));
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /specs\/b\.md.*not mapped/);
});

test('fails when tests/PLAN.md is missing', () => {
  const r = lintSpecs(target({ 'specs/a.md': GOOD['specs/a.md'] }));
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /tests\/PLAN\.md is missing/);
});

test('reports every problem, deterministically ordered', () => {
  const files = { 'specs/b.md': '', 'specs/a.md': 'no title\n', 'tests/PLAN.md': '' };
  const r1 = lintSpecs(target(files));
  const r2 = lintSpecs(target(files));
  assert.equal(r1.ok, false);
  assert.ok(r1.problems.length >= 4);
  assert.deepEqual(r1, r2);
});

test('hodgepodge spec-lint: exit 0 and JSON when clean', async () => {
  let out = '';
  const code = await main(['spec-lint', '--repo', target(GOOD)], { stdout: (s) => (out += s) });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out), { ok: true, problems: [] });
});

test('hodgepodge spec-lint: exit 1 and problems when dirty', async () => {
  let out = '';
  const code = await main(['spec-lint', '--repo', target({ ...GOOD, 'specs/b.md': '' })], { stdout: (s) => (out += s) });
  assert.equal(code, 1);
  assert.equal(JSON.parse(out).ok, false);
});

test('hodgepodge spec-lint: --repo defaults to cwd and bad args exit 2', async () => {
  let err = '';
  const code = await main(['spec-lint', '--bogus', 'x'], { stderr: (s) => (err += s) });
  assert.equal(code, 2);
  assert.match(err, /unknown argument/);
});
