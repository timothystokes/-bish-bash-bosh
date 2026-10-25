import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkReadiness, hasObjectiveKit, MIN_REQUIREMENTS } from '../src/readiness.js';

const goodSpec = `# Spec: Greeter

## Purpose
Greets people.

## Requirements
- \`greet(name)\` must return "Hello, name!".
- \`greet\` must throw a TypeError when name is not a string.
- \`greet\` must trim surrounding whitespace from name.

## Examples
- \`greet('Ann')\` -> \`Hello, Ann!\`
- \`greet(1)\` -> throws TypeError

## Out of scope
- Localisation.
`;

/** @param {Record<string, string>} files */
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ready-'));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

const plan = '| Spec | Tests |\n|---|---|\n| specs/greet.md | tests/greet.test.js |\n';
const ready = { 'specs/greet.md': goodSpec, 'tests/PLAN.md': plan, 'tests/greet.test.js': 'x\n' };

test('a fine-grained, mapped, lint-clean spec set is ready', () => {
  assert.deepEqual(checkReadiness(repo(ready)), { ready: true, gaps: [] });
});

test('spec-lint problems are readiness gaps', () => {
  const r = checkReadiness(repo({ 'specs/greet.md': goodSpec }));
  assert.equal(r.ready, false);
  assert.ok(r.gaps.some((g) => /tests\/PLAN\.md/.test(g)));
});

test(`fewer than ${MIN_REQUIREMENTS} requirements is too coarse`, () => {
  const spec = goodSpec.replace(/- `greet` must trim.*\n/, '');
  const r = checkReadiness(repo({ ...ready, 'specs/greet.md': spec }));
  assert.ok(r.gaps.some((g) => /specs\/greet\.md: 2 requirements/.test(g)), r.gaps.join('|'));
});

test('a requirement without "must" is not testable', () => {
  const spec = goodSpec.replace('must trim surrounding whitespace from name', 'should be nice to names');
  const r = checkReadiness(repo({ ...ready, 'specs/greet.md': spec }));
  assert.ok(r.gaps.some((g) => /not testable/.test(g) && /should be nice/.test(g)), r.gaps.join('|'));
});

test('a compound requirement (two musts) must be split', () => {
  const spec = goodSpec.replace('must trim surrounding whitespace from name', 'must trim whitespace and must lowercase it');
  const r = checkReadiness(repo({ ...ready, 'specs/greet.md': spec }));
  assert.ok(r.gaps.some((g) => /compound/.test(g)), r.gaps.join('|'));
});

test('too few examples for the requirements', () => {
  const spec = goodSpec.replace(/- `greet\(1\)`.*\n/, '').replace(/- `greet\('Ann'\)`.*\n/, '');
  const r = checkReadiness(repo({ ...ready, 'specs/greet.md': spec }));
  assert.ok(r.gaps.some((g) => /examples/.test(g)), r.gaps.join('|'));
});

test('a spec with no failure or negative path is incomplete', () => {
  const spec = goodSpec.replace('must throw a TypeError when name is not a string', 'must keep the casing').replace('throws TypeError', 'Hello, 1!');
  const r = checkReadiness(repo({ ...ready, 'specs/greet.md': spec }));
  assert.ok(r.gaps.some((g) => /negative|failure/.test(g)), r.gaps.join('|'));
});

test('empty Out of scope is a gap', () => {
  const spec = goodSpec.replace('- Localisation.\n', '');
  const r = checkReadiness(repo({ ...ready, 'specs/greet.md': spec }));
  assert.ok(r.gaps.some((g) => /out of scope/i.test(g)), r.gaps.join('|'));
});

test('placeholders (TBD, TODO, ??, <angle>) outside code are gaps; inside code they are fine', () => {
  const tbd = goodSpec.replace('Greets people.', 'Greets people. TBD');
  assert.ok(checkReadiness(repo({ ...ready, 'specs/greet.md': tbd })).gaps.some((g) => /placeholder/.test(g)));
  const angle = goodSpec.replace('Greets people.', 'Greets <who>.');
  assert.ok(checkReadiness(repo({ ...ready, 'specs/greet.md': angle })).gaps.some((g) => /placeholder/.test(g)));
  const code = goodSpec.replace('Greets people.', 'Greets `<who>` and `TODO`.');
  assert.deepEqual(checkReadiness(repo({ ...ready, 'specs/greet.md': code })), { ready: true, gaps: [] });
});

test('unchecked items in objective/OPEN-QUESTIONS.md block readiness; checked ones do not', () => {
  const open = repo({ ...ready, 'objective/OPEN-QUESTIONS.md': '# Open questions\n\n- [ ] Which locale?\n- [x] Casing?\n' });
  const r = checkReadiness(open);
  assert.equal(r.ready, false);
  assert.ok(r.gaps.some((g) => /open question/i.test(g) && /Which locale/.test(g)), r.gaps.join('|'));
  const done = repo({ ...ready, 'objective/OPEN-QUESTIONS.md': '# Open questions\n\n- [x] Which locale?\n' });
  assert.deepEqual(checkReadiness(done), { ready: true, gaps: [] });
});

test('a mapped test file that does not exist is a gap', () => {
  const r = checkReadiness(repo({ 'specs/greet.md': goodSpec, 'tests/PLAN.md': plan }));
  assert.ok(r.gaps.some((g) => /tests\/greet\.test\.js/.test(g) && /missing/.test(g)), r.gaps.join('|'));
});

test('hasObjectiveKit is true only when objective/ exists', () => {
  assert.equal(hasObjectiveKit(repo(ready)), false);
  assert.equal(hasObjectiveKit(repo({ ...ready, 'objective/PHASES.md': 'x\n' })), true);
});
