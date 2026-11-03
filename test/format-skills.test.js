import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORMATS } from '../src/formats.js';
import { loadFormatSkill } from '../src/prompts.js';
import { buildInterviewPrompt } from '../src/bish-interview.js';

/** @param {Record<string, string>} files */
function makeRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bish-skill-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

const spec = (/** @type {string} */ formats) =>
  `# Spec: S\nImplementation: none\n\n## Requirements\n- R-s-1: x\n\n## Formats\n${formats}\n`;

test('G-9: every registered format has a skill snippet that names it and shows its declaration', () => {
  for (const name of Object.keys(FORMATS)) {
    const s = loadFormatSkill(name);
    assert.match(s, new RegExp(`\\b${name}\\b`), name);
    assert.match(s, new RegExp(`- ${name}: `), `${name} declaration example`);
  }
});

test('G-9: an unknown format has no skill snippet', () => {
  assert.throws(() => loadFormatSkill('nope'), /no skill/i);
  assert.throws(() => loadFormatSkill('../prompts/interview'), /no skill/i);
});

test('G-9: the interview prompt carries a snippet only for formats a spec declares', () => {
  const none = buildInterviewPrompt(makeRepo({ 'specs/a.md': spec('') }), 'obj');
  assert.doesNotMatch(none, /## Format skill/);

  const dir = makeRepo({
    'specs/a.md': spec('- gherkin: specs/a.feature'),
    'specs/b.md': spec('- gherkin: specs/b.feature\n- bogus: specs/x'),
  });
  const p = buildInterviewPrompt(dir, 'obj');
  assert.equal([...p.matchAll(/## Format skill: gherkin/g)].length, 1);
  assert.doesNotMatch(p, /## Format skill: openapi/);
  assert.doesNotMatch(p, /## Format skill: bogus/);
});
