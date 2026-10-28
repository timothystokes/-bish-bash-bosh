import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkReadiness, hasObjectiveKit, MIN_REQUIREMENTS } from '../src/readiness.js';

const goodSpec = `# Spec: Greeter
Implementation: none

## Purpose
Greets people.

## Requirements
- R-greet-1: \`greet(name)\` must return "Hello, name!".
- R-greet-2: \`greet\` must throw a TypeError when name is not a string.
- R-greet-3: \`greet\` must trim surrounding whitespace from name.

## Examples
- \`greet('Ann')\` -> \`Hello, Ann!\`
- \`greet(1)\` -> throws TypeError

## Dimensions
- Actors and goals: covered
- Behaviour: covered
- Inputs and outputs: covered
- Failure paths: covered
- Edge cases: n/a: a single string argument has no collection edge cases
- Interfaces and data: n/a: one in-process function
- Non-functional: n/a: no runtime limits for a pure function
- Constraints: n/a: no platform constraints
- Acceptance: covered
- Out of scope: covered

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

const ready = { 'specs/greet.md': goodSpec };

test('a fine-grained, lint-clean spec set is ready without any tests or tests/PLAN.md (the plan stage writes them)', () => {
  assert.deepEqual(checkReadiness(repo(ready)), { ready: true, gaps: [] });
});

test('spec-lint structure problems are readiness gaps', () => {
  const r = checkReadiness(repo({ 'specs/greet.md': 'no title\n' }));
  assert.equal(r.ready, false);
  assert.ok(r.gaps.some((g) => /# Spec:/.test(g)), r.gaps.join('|'));
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
  const open = repo({ ...ready, 'objective/OPEN-QUESTIONS.md': '# Open questions\n\n1 - Answered: [ ]; Specified: [ ]; Topic: L; Q: Which locale?; Default: en\n2 - Answered: [x]; Specified: [x]; Topic: L; Q: Casing?; A: lower\n' });
  const r = checkReadiness(open);
  assert.equal(r.ready, false);
  assert.ok(r.gaps.some((g) => /open question/i.test(g) && /Which locale/.test(g)), r.gaps.join('|'));
  const done = repo({ ...ready, 'objective/OPEN-QUESTIONS.md': '# Open questions\n\n1 - Answered: [x]; Specified: [x]; Topic: L; Q: Which locale?; A: en; Spec: specs/greet.md\n' });
  assert.deepEqual(checkReadiness(done), { ready: true, gaps: [] });
});

test('hasObjectiveKit is true only when objective/ exists', () => {
  assert.equal(hasObjectiveKit(repo(ready)), false);
  assert.equal(hasObjectiveKit(repo({ ...ready, 'objective/PHASES.md': 'x\n' })), true);
});

test('a vague word in a requirement is a gap, with or without a threshold nearby', () => {
  for (const word of ['fast', 'secure', 'robust', 'user-friendly', 'Easy']) {
    const spec = goodSpec.replace('must trim surrounding whitespace from name', `must be ${word} when trimming`);
    const r = checkReadiness(repo({ ...ready, 'specs/greet.md': spec }));
    assert.ok(r.gaps.some((g) => /vague/.test(g) && g.includes(word.toLowerCase())), `${word}: ${r.gaps.join('|')}`);
  }
});

test('vague words inside code spans or outside requirements are not flagged', () => {
  const spec = goodSpec.replace('must trim surrounding whitespace from name', 'must trim whitespace from `fast` names').replace('Greets people.', 'Greets people fast.');
  assert.deepEqual(checkReadiness(repo({ ...ready, 'specs/greet.md': spec })), { ready: true, gaps: [] });
});

test('a non-functional requirement without a number is a gap; with a threshold it passes', () => {
  const bare = goodSpec.replace('must trim surrounding whitespace from name', 'must keep latency low when trimming');
  const r = checkReadiness(repo({ ...ready, 'specs/greet.md': bare }));
  assert.ok(r.gaps.some((g) => /non-functional/.test(g) && /no measurable threshold/.test(g)), r.gaps.join('|'));
  const measured = goodSpec.replace('must trim surrounding whitespace from name', 'must keep p95 latency under 5 ms when trimming');
  assert.deepEqual(checkReadiness(repo({ ...ready, 'specs/greet.md': measured })), { ready: true, gaps: [] });
});

test('a spec without a Dimensions section is a gap naming every dimension', () => {
  const spec = goodSpec.replace(/## Dimensions[\s\S]*?\n(?=## Out of scope)/, '');
  const r = checkReadiness(repo({ ...ready, 'specs/greet.md': spec }));
  for (const d of ['Actors and goals', 'Behaviour', 'Inputs and outputs', 'Failure paths', 'Edge cases', 'Interfaces and data', 'Non-functional', 'Constraints', 'Acceptance', 'Out of scope']) {
    assert.ok(r.gaps.some((g) => /specs\/greet\.md/.test(g) && /dimension/.test(g) && g.includes(d)), `${d}: ${r.gaps.join('|')}`);
  }
});

test('a single missing dimension is a gap naming only it', () => {
  const spec = goodSpec.replace('- Constraints: n/a: no platform constraints\n', '');
  const r = checkReadiness(repo({ ...ready, 'specs/greet.md': spec }));
  const dim = r.gaps.filter((g) => /dimension/.test(g));
  assert.equal(dim.length, 1, r.gaps.join('|'));
  assert.match(dim[0], /Constraints/);
});

test('n/a without a reason, an unknown status, an unknown dimension, or a duplicate is a gap', () => {
  /** @type {[string, string, RegExp][]} */
  const cases = [
    ['- Constraints: n/a: no platform constraints', '- Constraints: n/a', /Constraints.*reason/],
    ['- Constraints: n/a: no platform constraints', '- Constraints: maybe', /Constraints.*covered/],
    ['- Constraints: n/a: no platform constraints', '- Constraints: n/a: none\n- Vibes: covered', /unknown dimension.*Vibes/],
    ['- Constraints: n/a: no platform constraints', '- Constraints: n/a: none\n- Constraints: covered', /duplicate.*Constraints/],
  ];
  for (const [from, to, re] of cases) {
    const r = checkReadiness(repo({ ...ready, 'specs/greet.md': goodSpec.replace(from, to) }));
    assert.ok(r.gaps.some((g) => re.test(g)), `${to}: ${r.gaps.join('|')}`);
  }
});

test('"Out of scope: covered" with an empty Out of scope section is still a gap', () => {
  const r = checkReadiness(repo({ ...ready, 'specs/greet.md': goodSpec.replace('- Localisation.\n', '') }));
  assert.ok(r.gaps.some((g) => /out of scope is empty/i.test(g)), r.gaps.join('|'));
});
