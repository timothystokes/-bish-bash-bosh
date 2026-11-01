import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODES, loadModePrompt, loadQaPrompt } from '../src/prompts.js';

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
test('snapshot: qa prompt', () => matchSnapshot('qa', loadQaPrompt()));

const BUILD_MODES = ['forward', 'brownfield', 'clean-room'];

test('H-13: build prompts scope the red step to the new test file and reserve the full suite for green', () => {
  for (const mode of BUILD_MODES) {
    const p = loadModePrompt(mode);
    assert.match(p, /only the (new|changed) test file/i, mode);
    assert.match(p, /confirm (it|they) fail/i, mode);
    assert.match(p, /full suite (only )?(to confirm|for) green/i, mode);
  }
});

test('interview-loop.md tells the agent to update specification.md, adjust unprocessed questions and append follow-up questions in the store\'s own line format, then stop', () => {
  const kit = readFileSync(join(snapDir, '..', '..', 'prompts', 'interview-loop.md'), 'utf8');
  for (const text of [loadModePrompt('interview'), kit]) {
    assert.match(text, /specification\.md/i);
    assert.match(text, /interview\.md/i);
    assert.match(text, /\[ \] Q: <question> A: <default answer>/);
    assert.match(text, /stop/i);
  }
});

test('H-16: gate-checked prompts forbid gaming the gate', () => {
  for (const mode of [...BUILD_MODES, 'test-hardening']) {
    const p = loadModePrompt(mode);
    assert.match(p, /never (tick|mark)[^.\n]*(done|implemented)[^.\n]*(satisfy|pass)[^.\n]*gate/i, mode);
    assert.match(p, /do not weaken (any )?(validation|check)/i, mode);
  }
});

test('H-19: test-hardening needs a green baseline, a throwaway worktree and a diagnosis per surviving mutant', () => {
  const p = loadModePrompt('test-hardening');
  assert.match(p, /green baseline/i);
  assert.match(p, /before (running )?(the )?mutation/i);
  assert.match(p, /throwaway (git )?worktree/i);
  assert.match(p, /never (in|on) the real (repo|checkout|working tree)/i);
  assert.match(p, /surviving mutant/i);
  assert.match(p, /bad mutant/i);
  assert.match(p, /weak test/i);
  assert.match(p, /missing spec/i);
});
