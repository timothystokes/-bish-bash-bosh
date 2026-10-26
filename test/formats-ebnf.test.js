import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FORMATS, checkFormats } from '../src/formats.js';

/** @param {Record<string, string>} files */
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ebnf-'));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

const GOOD = `/* accept: "1+2" */
/* accept: "7" */
/* reject: "1+" */
/* reject: "" */
expr ::= num ("+" num)*
num ::= [0-9]+
`;

const validate = (/** @type {string} */ text, name = 'a.ebnf') => {
  const dir = repo({ [name]: text });
  return FORMATS.ebnf.validate(join(dir, name));
};

test('ebnf is a registered format', () => {
  assert.ok(Object.hasOwn(FORMATS, 'ebnf'));
});

test('a grammar whose examples behave as declared passes', () => {
  assert.deepEqual(validate(GOOD), []);
});

test('a declared-accept example the grammar rejects is reported', () => {
  const out = validate(GOOD.replace('"7"', '"7+"'));
  assert.match(out.join('\n'), /example "7\+" is declared accept but the grammar rejects it/);
});

test('a declared-reject example the grammar accepts is reported', () => {
  const out = validate(GOOD.replace('reject: "1+"', 'reject: "1+3"'));
  assert.match(out.join('\n'), /example "1\+3" is declared reject but the grammar accepts it/);
});

test('trailing input is a rejection, not a partial accept', () => {
  assert.deepEqual(validate('/* accept: "ab" */\n/* reject: "abc" */\nr ::= "a" "b"\n'), []);
});

test('a grammar that does not parse is reported', () => {
  assert.match(validate('/* accept: "x" */\nexpr ::= ( \n').join('\n'), /invalid EBNF/);
});

test('a reference to an undefined rule is reported', () => {
  assert.match(validate('/* accept: "x" */\nexpr ::= missing\n').join('\n'), /invalid EBNF.*Missing rule missing/);
});

test('a grammar with no rules is reported', () => {
  assert.match(validate('/* accept: "x" */\n').join('\n'), /invalid EBNF|no rules/);
});

test('a grammar with no examples is reported', () => {
  assert.match(validate('expr ::= "a"\n').join('\n'), /no examples/);
});

test('a grammar with only accept examples is reported', () => {
  assert.match(validate('/* accept: "a" */\nexpr ::= "a"\n').join('\n'), /needs at least one reject example/);
});

test('a malformed example comment is reported', () => {
  assert.match(validate('/* accept: a */\n/* reject: "b" */\nexpr ::= "a"\n').join('\n'), /malformed example/);
});

test('crossCheck has nothing to flag across grammars', () => {
  assert.deepEqual(FORMATS.ebnf.crossCheck(['a', 'b']), []);
});

test('checkFormats reports a bad ebnf artifact and accepts a good one', () => {
  const spec = (/** @type {string} */ p) => `# Spec: s\n\n## Requirements\n- R-s-1: input obeys ${p}\n\n## Formats\n- ebnf: ${p}\n`;
  const bad = repo({ 'specs/s.md': spec('specs/g.ebnf'), 'specs/g.ebnf': 'expr ::= "a"\n' });
  assert.match(checkFormats(bad).join('\n'), /ebnf artifact specs\/g\.ebnf: no examples/);
  const good = repo({ 'specs/s.md': spec('specs/g.ebnf'), 'specs/g.ebnf': GOOD });
  assert.deepEqual(checkFormats(good), []);
});
