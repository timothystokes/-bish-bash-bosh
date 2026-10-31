import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSpecificationItems, nextSpecificationItem, runPlanLoop, buildPlanLoopPrompt } from '../src/podge-plan-loop.js';
import { loadModePrompt } from '../src/prompts.js';

const sample = [
  '# Specification',
  '',
  'This is a list of Constraints (C) with the expected Benefit (B) from applying that constrain.',
  '',
  '1. [ ] C: Provide a login screen. B: Users can authenticate.',
  '2. [ ] C: Rate-limit login attempts. B: Prevent brute force.',
  '3. [x] C: Already specified. B: done already',
  '',
].join('\n');

test('parseSpecificationItems reads each numbered `N. [ ] C: ... B: ...` line', () => {
  const items = parseSpecificationItems(sample);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { id: 1, checked: false, constraint: 'Provide a login screen.', benefit: 'Users can authenticate.', lineIndex: 4 });
  assert.equal(items[1].constraint, 'Rate-limit login attempts.');
  assert.equal(items[2].checked, true);
});

test('parseSpecificationItems tolerates a parenthetical remark before the `B:` label', () => {
  const items = parseSpecificationItems('4. [ ] C: Validate email input. B (impact): Fewer bad records.');
  assert.equal(items.length, 1, 'the line is still recognised as an item, not silently dropped');
  assert.equal(items[0].constraint, 'Validate email input.');
  assert.equal(items[0].benefit, 'Fewer bad records.');
});

test('nextSpecificationItem is the first item not yet checked, skipping already-processed ones', () => {
  assert.equal(nextSpecificationItem(parseSpecificationItems(sample))?.id, 1);
  assert.equal(nextSpecificationItem(parseSpecificationItems(sample.replace('1. [ ]', '1. [x]')))?.id, 2);
});

test('buildPlanLoopPrompt prefaces prompts/plan-loop.md onto the item\'s constraint and benefit', () => {
  const p = buildPlanLoopPrompt({ constraint: 'Provide a login screen.', benefit: 'Users can authenticate.' });
  assert.ok(p.startsWith(loadModePrompt('plan-loop')));
  assert.match(p, /## Constraint\n\nProvide a login screen\.\n\n## Benefit\n\nUsers can authenticate\./);
});

function makeFile() {
  const dir = mkdtempSync(join(tmpdir(), 'podge-plan-loop-'));
  const path = join(dir, 'specification.md');
  writeFileSync(path, sample);
  return { path, dir };
}

const io = () => ({ readFile: (p) => readFileSync(p, 'utf8'), writeFile: (p, s) => writeFileSync(p, s) });

/**
 * @param {{ exitStatus: number, transcript: string, changedFiles: string[], session?: unknown }
 *   | ((req: any, callIndex: number) => { session?: unknown })} [result]
 */
function fakeAdapter(result = { exitStatus: 0, transcript: '', changedFiles: [] }) {
  const calls = [];
  return {
    calls,
    run: async (req) => {
      calls.push(req);
      const r = typeof result === 'function' ? result(req, calls.length) : result;
      return { exitStatus: 0, transcript: '', changedFiles: [], session: req.session, ...r };
    },
  };
}

function sessionStore() {
  const store = { session: undefined };
  return { loadSession: () => store.session, saveSession: (s) => { store.session = s; }, store };
}

test('runPlanLoop hands every unprocessed item to the agent in turn, marking each processed once its round completes', async () => {
  const { path: specificationPath, dir } = makeFile();
  const adapter = fakeAdapter();
  const res = await runPlanLoop({ specificationPath, ...io(), say: () => {}, adapter, repoDir: dir, ...sessionStore() });
  assert.equal(res.status, 'ok');
  assert.equal(res.processed, 2);
  const after = parseSpecificationItems(readFileSync(specificationPath, 'utf8'));
  assert.equal(after[0].checked, true);
  assert.equal(after[1].checked, true);
  assert.equal(after[2].checked, true, 'already-processed item stays untouched but still checked');
  assert.equal(adapter.calls.length, 2);
  assert.match(adapter.calls[0].prompt, /## Constraint\n\nProvide a login screen\.\n\n## Benefit\n\nUsers can authenticate\./);
  assert.equal(adapter.calls[0].cwd, dir);
});

test('runPlanLoop shows each item in colour with a "Thinking..." line before the agent is called', async () => {
  const { path: specificationPath, dir } = makeFile();
  const said = [];
  await runPlanLoop({ specificationPath, ...io(), say: (s) => said.push(s), adapter: fakeAdapter(), repoDir: dir, ...sessionStore() });
  assert.match(said[0], /\x1b\[1;36mC: Provide a login screen\.\x1b\[0m/);
  assert.match(said[1], /^\x1b\[90mThinking\.\.\.\x1b\[0m\n$/);
});

test('once every item is processed, a further call reports ok with nothing left to hand to the agent', async () => {
  const { path: specificationPath, dir } = makeFile();
  await runPlanLoop({ specificationPath, ...io(), say: () => {}, adapter: fakeAdapter(), repoDir: dir, ...sessionStore() });
  const adapter = fakeAdapter();
  const res = await runPlanLoop({ specificationPath, ...io(), say: () => {}, adapter, repoDir: dir, ...sessionStore() });
  assert.equal(res.status, 'ok');
  assert.equal(res.processed, 0);
  assert.equal(adapter.calls.length, 0);
});

test('the same session is threaded through every item, and persisted via saveSession/loadSession', async () => {
  const { path: specificationPath, dir } = makeFile();
  const adapter = fakeAdapter((req) => ({ session: req.session ? `${req.session}+` : 's1' }));
  const session = sessionStore();
  await runPlanLoop({ specificationPath, ...io(), say: () => {}, adapter, repoDir: dir, ...session });
  assert.equal(adapter.calls[0].session, undefined, 'no session yet on the very first item');
  assert.equal(adapter.calls[1].session, 's1', 'the second item resumes what the first item returned');
  assert.equal(session.store.session, 's1+', 'the final session is persisted for a future podge invocation');
});
