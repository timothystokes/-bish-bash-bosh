import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODES, loadModePrompt } from '../src/prompts.js';

const snapDir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots');

/**
 * Compare against test/snapshots/<name>.txt; `UPDATE_SNAPSHOTS=1 npm test` rewrites them.
 * @param {string} name
 * @param {string} actual
 */
function matchSnapshot(name, actual) {
  const file = join(snapDir, `${name}.txt`);
  if (process.env.UPDATE_SNAPSHOTS === '1') {
    mkdirSync(snapDir, { recursive: true });
    writeFileSync(file, `${actual}\n`);
  }
  assert.ok(existsSync(file), `missing snapshot ${name}.txt (run UPDATE_SNAPSHOTS=1 npm test)`);
  assert.equal(`${actual}\n`, readFileSync(file, 'utf8'), `prompt ${name} changed: review it, then UPDATE_SNAPSHOTS=1 npm test`);
}

for (const mode of MODES) {
  test(`snapshot: ${mode} prompt`, () => matchSnapshot(mode, loadModePrompt(mode)));
}

test('interview-loop.md tells the agent to update specification.md, adjust unprocessed questions and append follow-up questions in the store\'s own line format, then stop', () => {
  const kit = readFileSync(join(snapDir, '..', '..', 'prompts', 'interview-loop.md'), 'utf8');
  for (const text of [loadModePrompt('interview'), kit]) {
    assert.match(text, /specification\.md/i);
    assert.match(text, /interview\.md/i);
    assert.match(text, /\[ \] Q: <question> A: <default answer>/);
    assert.match(text, /stop/i);
  }
});

