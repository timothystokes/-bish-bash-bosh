import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import analystInit from '../../src/bish/prompts/bish-analyst-init.js';
import analystLoop from '../../src/bish/prompts/bish-analyst-loop.js';
import reverseEngineer from '../../src/bish/prompts/bish-reverse-engineer.js';
import planner from '../../src/bash/prompts/bash-planner.js';
import testWriter from '../../src/bosh/prompts/bosh-test-writer.js';
import builder from '../../src/bosh/prompts/bosh-builder.js';
import inspector from '../../src/bosh/prompts/bosh-inspector.js';
import analystIntro from '../../src/bish/prompts/bish-analyst-intro.js';

const snapDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'snapshots');

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

// Each prompt function rendered with placeholder arguments; the build personas also with feedback.
const CONTEXT = ['3. [ ] C: <constraint> B: <benefit> Q: 1', '1. [x] Q: <question> A: <answer>'];

const SNAPSHOTS = {
  'analyst-init': () => analystInit(),
  'analyst-loop': () => analystLoop('<item>'),
  'reverse-engineer': () => reverseEngineer('<focus>', '<template>'),
  planner: () => planner(),
  'test-writer': () => testWriter('<item>', '', '<testfile>', '3. [ ] C: <constraint> B: <benefit> Q: TBC'),
  'test-writer-feedback': () => testWriter('<item>', '<feedback>', '<testfile>', ''),
  builder: () => builder('<item>', '', '<testfile>', '<resultsfile>'),
  'builder-feedback': () => builder('<item>', '<feedback>', '<testfile>', '<resultsfile>'),
  'builder-context': () => builder('<item>', '', '<testfile>', ...CONTEXT),
  'inspector-context': () => inspector('<item>', '', '<testfile>', '<resultsfile>', ...CONTEXT),
  inspector: () => inspector('<item>', '', '<testfile>', '<resultsfile>'),
  'inspector-feedback': () => inspector('<item>', '<feedback>', '<testfile>', '<resultsfile>'),
};
for (const [name, render] of Object.entries(SNAPSHOTS)) {
  test(`snapshot: ${name} prompt`, () => matchSnapshot(name, render()));
}

test('the analyst prompts tell the agent to update specification.md, adjust unprocessed questions and append follow-up questions in the store\'s own line format, then stop (the line format lives in the intro)', () => {
  assert.match(analystIntro(), /\[ \] Q: <question> A: <answer>/);
  const text = analystLoop('<item>');
  assert.match(text, /specification\.md/i);
  assert.match(text, /interview\.md/i);
  assert.match(text, /stop/i);
});
