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
  'specs/a.md': '# Spec: Alpha\nImplementation: none\n\n## Requirements\n- R-a-1: a must do a.\n',
  'specs/b.md': '# Spec: Beta\nImplementation: none\n\n## Requirements\n- R-b-1: b must do b.\n',
  'tests/PLAN.md': '| specs/a.md | tests/a.test.js |\n| specs/b.md | tests/b.test.js |\n| R-a-1 | tests/a.test.js |\n| R-b-1 | tests/b.test.js |\n',
};

test('passes for well-formed, mapped specs', () => {
  assert.deepEqual(lintSpecs(target(GOOD)), { ok: true, problems: [] });
});

test('testPlan: false checks structure only: no tests/PLAN.md needed, bad structure still fails', () => {
  const { 'tests/PLAN.md': _plan, ...specsOnly } = GOOD;
  assert.equal(lintSpecs(target(specsOnly)).ok, false);
  assert.deepEqual(lintSpecs(target(specsOnly), { testPlan: false }), { ok: true, problems: [] });
  assert.equal(lintSpecs(target({ 'specs/a.md': 'no title\n' }), { testPlan: false }).ok, false);
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
  const r = lintSpecs(target({ ...GOOD, 'specs/b.md': '# Beta\nImplementation: none\n- b\n' }));
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /specs\/b\.md.*# Spec:/);
});

test('fails when a spec holds more than one decision (several top-level titles)', () => {
  const r = lintSpecs(target({ ...GOOD, 'specs/b.md': '# Spec: Beta\nImplementation: none\n- b\n# Spec: Gamma\n- g\n' }));
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /specs\/b\.md.*one decision/);
});

test('ignores "#" lines inside code fences when counting titles', () => {
  const r = lintSpecs(target({ ...GOOD, 'specs/b.md': '# Spec: Beta\nImplementation: none\n```sh\n# comment\n```\n\n## Requirements\n- R-b-1: b must do b.\n' }));
  assert.deepEqual(r, { ok: true, problems: [] });
});

test('fails on duplicate titles across specs', () => {
  const r = lintSpecs(target({ ...GOOD, 'specs/b.md': '# Spec: alpha\nImplementation: none\n- b\n' }));
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

const withPlanRows = (/** @type {string} */ rows) => `| specs/a.md | tests/a.test.js |\n| specs/b.md | tests/b.test.js |\n${rows}`;

test('fails when a spec has no Implementation field', () => {
  const r = lintSpecs(target({ ...GOOD, 'specs/b.md': '# Spec: Beta\n\n## Requirements\n- R-b-1: b must do b.\n' }));
  assert.match(r.problems.join('\n'), /specs\/b\.md.*Implementation/);
});

test('fails on an Implementation value other than none|partial|implemented', () => {
  const r = lintSpecs(target({ ...GOOD, 'specs/b.md': GOOD['specs/b.md'].replace('none', 'done') }));
  assert.match(r.problems.join('\n'), /specs\/b\.md.*Implementation.*none\|partial\|implemented/);
});

test('partial or implemented needs evidence links that exist; none needs none', () => {
  const noEv = lintSpecs(target({ ...GOOD, 'specs/b.md': GOOD['specs/b.md'].replace('none', 'partial') }));
  assert.match(noEv.problems.join('\n'), /specs\/b\.md.*Evidence/);
  const missing = lintSpecs(target({ ...GOOD, 'tests/b.test.js': 'x', 'specs/b.md': GOOD['specs/b.md'].replace('none', 'implemented\nEvidence: `src/b.js`, tests/b.test.js') }));
  assert.match(missing.problems.join('\n'), /specs\/b\.md.*evidence file missing: src\/b\.js/);
  assert.doesNotMatch(missing.problems.join('\n'), /tests\/b\.test\.js/);
  const ok = lintSpecs(target({ ...GOOD, 'src/b.js': 'x', 'tests/b.test.js': 'x', 'specs/b.md': GOOD['specs/b.md'].replace('none', 'implemented\nEvidence: `src/b.js`, tests/b.test.js') }));
  assert.deepEqual(ok, { ok: true, problems: [] });
});

test('Implementation lines inside code fences do not count', () => {
  const r = lintSpecs(target({ ...GOOD, 'specs/b.md': '# Spec: Beta\n```\nImplementation: none\n```\n' }));
  assert.match(r.problems.join('\n'), /specs\/b\.md.*Implementation/);
});

test('requirements need IDs of the form R-<spec>-<n>, unique within the spec', () => {
  const bare = lintSpecs(target({ ...GOOD, 'specs/b.md': GOOD['specs/b.md'].replace('R-b-1: ', '') }));
  assert.match(bare.problems.join('\n'), /specs\/b\.md.*requirement.*R-b-<n>/);
  const wrong = lintSpecs(target({ ...GOOD, 'specs/b.md': GOOD['specs/b.md'].replace('R-b-1', 'R-a-1') }));
  assert.match(wrong.problems.join('\n'), /specs\/b\.md.*R-b-<n>/);
  const dup = lintSpecs(target({ ...GOOD, 'specs/b.md': `${GOOD['specs/b.md']}- R-b-1: b must also do c.\n` }));
  assert.match(dup.problems.join('\n'), /specs\/b\.md.*duplicate.*R-b-1/);
});

test('every requirement ID must be mapped to an executable test in tests/PLAN.md', () => {
  const r = lintSpecs(target({ ...GOOD, 'tests/PLAN.md': withPlanRows('| R-a-1 | tests/a.test.js |\n') }));
  assert.match(r.problems.join('\n'), /R-b-1.*not mapped/);
  const noTest = lintSpecs(target({ ...GOOD, 'tests/PLAN.md': withPlanRows('| R-a-1 | tests/a.test.js |\n| R-b-1 | |\n') }));
  assert.match(noTest.problems.join('\n'), /R-b-1.*not mapped/);
});

test('a PLAN.md requirement ID that no spec declares is a problem', () => {
  const r = lintSpecs(target({ ...GOOD, 'tests/PLAN.md': withPlanRows('| R-a-1 | tests/a.test.js |\n| R-b-1 | tests/b.test.js |\n| R-z-9 | tests/a.test.js |\n') }));
  assert.match(r.problems.join('\n'), /R-z-9.*no spec/);
});

test('hodgepodge spec-lint: exit 0 and ok message when clean', async () => {
  let out = '';
  const code = await main(['spec-lint', '--repo', target(GOOD)], { stdout: (s) => (out += s) });
  assert.equal(code, 0);
  assert.equal(out, 'spec-lint: ok\n');
});

test('hodgepodge spec-lint: exit 1 and problems when dirty', async () => {
  let out = '';
  const code = await main(['spec-lint', '--repo', target({ ...GOOD, 'specs/b.md': '' })], { stdout: (s) => (out += s) });
  assert.equal(code, 1);
  assert.match(out, /^spec-lint: \d+ problems?\n/);
});

test('hodgepodge spec-lint: --repo defaults to cwd and bad args exit 2', async () => {
  let err = '';
  const code = await main(['spec-lint', '--bogus', 'x'], { stderr: (s) => (err += s) });
  assert.equal(code, 2);
  assert.match(err, /unknown argument/);
});
