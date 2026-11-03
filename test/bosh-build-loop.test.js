import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlanItems, nextPlanItem, runBuildLoop, buildBuildLoopPrompt, buildQaLoopPrompt } from '../src/bosh-build-loop.js';
import { loadModePrompt } from '../src/prompts.js';

const sample = [
  '# Plan',
  '',
  '- [ ] Phase: High Level Design. Task: Establish architectural constraints.',
  '- [ ] Phase: Core. Task: Implement the login screen.',
  '- [x] Phase: Done already. Task: Already implemented.',
  '',
].join('\n');

test('parsePlanItems reads each `- [ ] Phase: ... Task: ...` line', () => {
  const items = parsePlanItems(sample);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { checked: false, phase: 'High Level Design.', task: 'Establish architectural constraints.', lineIndex: 2 });
  assert.equal(items[1].task, 'Implement the login screen.');
  assert.equal(items[2].checked, true);
});

test('nextPlanItem is the first item not yet checked, skipping already-processed ones', () => {
  assert.equal(nextPlanItem(parsePlanItems(sample))?.phase, 'High Level Design.');
  assert.equal(nextPlanItem(parsePlanItems(sample.replace('- [ ] Phase: High Level Design.', '- [x] Phase: High Level Design.')))?.phase, 'Core.');
});

test('buildBuildLoopPrompt prefaces prompts/build-loop.md onto the item\'s phase and task', () => {
  const p = buildBuildLoopPrompt({ phase: 'Core.', task: 'Implement the login screen.' });
  assert.ok(p.startsWith(loadModePrompt('build-loop')));
  assert.match(p, /## Phase\n\nCore\.\n\n## Task\n\nImplement the login screen\./);
});

test('buildQaLoopPrompt prefaces prompts/qa-loop.md onto the same item\'s phase and task', () => {
  const p = buildQaLoopPrompt({ phase: 'Core.', task: 'Implement the login screen.' });
  assert.ok(p.startsWith(loadModePrompt('qa-loop')));
  assert.match(p, /## Phase\n\nCore\.\n\n## Task\n\nImplement the login screen\./);
});

function makeFile() {
  const dir = mkdtempSync(join(tmpdir(), 'bosh-build-loop-'));
  const path = join(dir, 'plan.md');
  writeFileSync(path, sample);
  return { path, dir };
}

const io = () => ({ readFile: (p) => readFileSync(p, 'utf8'), writeFile: (p, s) => writeFileSync(p, s) });

const passingTests = () => ({ ok: true, output: '' });

/**
 * @param {{ exitStatus: number, transcript: string, changedFiles: string[] }
 *   | ((req: any, callIndex: number) => object)} [result]
 */
function fakeAdapter(result = { exitStatus: 0, transcript: '', changedFiles: [] }) {
  const calls = [];
  return {
    calls,
    run: async (req) => {
      calls.push(req);
      const r = typeof result === 'function' ? result(req, calls.length) : result;
      return { exitStatus: 0, transcript: '', changedFiles: [], ...r };
    },
  };
}

test('runBuildLoop hands every unprocessed item to the agent (build then QA) in turn, ticking each once both test gates pass', async () => {
  const { path: planPath, dir } = makeFile();
  const adapter = fakeAdapter();
  const res = await runBuildLoop({ planPath, ...io(), say: () => {}, adapter, repoDir: dir, runTests: passingTests });
  assert.equal(res.status, 'ok');
  assert.equal(res.processed, 2);
  const after = parsePlanItems(readFileSync(planPath, 'utf8'));
  assert.equal(after[0].checked, true);
  assert.equal(after[1].checked, true);
  assert.equal(after[2].checked, true, 'already-processed item stays untouched but still checked');
  assert.equal(adapter.calls.length, 4, 'two agent calls (build, QA) per item, two items');
  assert.match(adapter.calls[0].prompt, /## Phase\n\nHigh Level Design\.\n\n## Task\n\nEstablish architectural constraints\./);
  assert.ok(adapter.calls[0].prompt.startsWith(loadModePrompt('build-loop')), 'first call of an item is the build prompt');
  assert.ok(adapter.calls[1].prompt.startsWith(loadModePrompt('qa-loop')), 'second call of an item is the QA prompt');
  assert.equal(adapter.calls[0].cwd, dir);
});

test('no call ever opts into session tracking: every build and QA call is a fresh agent context', async () => {
  const { path: planPath, dir } = makeFile();
  const adapter = fakeAdapter();
  await runBuildLoop({ planPath, ...io(), say: () => {}, adapter, repoDir: dir, runTests: passingTests });
  for (const call of adapter.calls) assert.ok(!Object.hasOwn(call, 'session'), 'no "session" key on any request');
});

test('runBuildLoop shows each item in colour with "Thinking..." before the build call and "Verifying..." before the QA call', async () => {
  const { path: planPath, dir } = makeFile();
  const said = [];
  await runBuildLoop({ planPath, ...io(), say: (s) => said.push(s), adapter: fakeAdapter(), repoDir: dir, runTests: passingTests });
  assert.match(said[0], /\x1b\[1;36mPhase: High Level Design\.\x1b\[0m/);
  assert.match(said[1], /^\x1b\[90mThinking\.\.\.\x1b\[0m\n$/);
  assert.match(said[2], /^\x1b\[90mVerifying\.\.\.\x1b\[0m\n$/);
});

test('once every item is processed, a further call reports ok with nothing left to hand to the agent', async () => {
  const { path: planPath, dir } = makeFile();
  await runBuildLoop({ planPath, ...io(), say: () => {}, adapter: fakeAdapter(), repoDir: dir, runTests: passingTests });
  const adapter = fakeAdapter();
  const res = await runBuildLoop({ planPath, ...io(), say: () => {}, adapter, repoDir: dir, runTests: passingTests });
  assert.equal(res.status, 'ok');
  assert.equal(res.processed, 0);
  assert.equal(adapter.calls.length, 0);
});

test('a failing test gate after the build call stops the loop, leaves the item unticked, and never calls QA', async () => {
  const { path: planPath, dir } = makeFile();
  const adapter = fakeAdapter();
  const res = await runBuildLoop({
    planPath, ...io(), say: () => {}, adapter, repoDir: dir,
    runTests: () => ({ ok: false, output: 'boom' }),
  });
  assert.equal(res.status, 'failed');
  assert.equal(res.processed, 0);
  assert.equal(res.item.phase, 'High Level Design.');
  assert.equal(res.output, 'boom');
  assert.equal(adapter.calls.length, 1, 'only the build call happens; QA is never reached');
  const after = parsePlanItems(readFileSync(planPath, 'utf8'));
  assert.equal(after[0].checked, false, 'left unticked so a later `bosh` run retries it');
});

test('a failing test gate after the QA call stops the loop and still leaves the item unticked', async () => {
  const { path: planPath, dir } = makeFile();
  const adapter = fakeAdapter();
  let call = 0;
  const res = await runBuildLoop({
    planPath, ...io(), say: () => {}, adapter, repoDir: dir,
    runTests: () => { call++; return { ok: call === 1, output: call === 1 ? '' : 'still broken' }; },
  });
  assert.equal(res.status, 'failed');
  assert.equal(res.processed, 0);
  assert.equal(res.output, 'still broken');
  assert.equal(adapter.calls.length, 2, 'both build and QA calls happen before the second gate fails');
  const after = parsePlanItems(readFileSync(planPath, 'utf8'));
  assert.equal(after[0].checked, false);
});

test('a later `bosh` run picks up the same still-unticked item after a gate failure', async () => {
  const { path: planPath, dir } = makeFile();
  await runBuildLoop({
    planPath, ...io(), say: () => {}, adapter: fakeAdapter(), repoDir: dir,
    runTests: () => ({ ok: false, output: 'boom' }),
  });
  const adapter = fakeAdapter();
  const res = await runBuildLoop({ planPath, ...io(), say: () => {}, adapter, repoDir: dir, runTests: passingTests });
  assert.equal(res.status, 'ok');
  assert.equal(res.processed, 2, 'the previously-failed item and the one after it both get processed');
  assert.match(adapter.calls[0].prompt, /Establish architectural constraints\./, 'the same item is retried from scratch');
});

test('log is called with the full prompt sent for each agent call (\'bosh\') and the full accumulated reasoning text (\'agent\') when the agent streams any', async () => {
  const { path: planPath, dir } = makeFile();
  const logged = [];
  const adapter = fakeAdapter((req) => {
    req.onReasoning?.('step one, ');
    req.onReasoning?.('step two');
    return {};
  });
  await runBuildLoop({
    planPath, ...io(), say: () => {}, adapter, repoDir: dir, runTests: passingTests,
    log: (source, text) => logged.push([source, text]),
  });
  assert.equal(logged[0][0], 'bosh');
  assert.match(logged[0][1], /## Phase\n\nHigh Level Design\.\n\n## Task\n\nEstablish architectural constraints\./);
  assert.deepEqual(logged[1], ['agent', 'step one, step two']);
  assert.equal(logged[2][0], 'bosh');
  assert.ok(logged[2][1].startsWith(loadModePrompt('qa-loop')), 'the third logged prompt is the QA call');
});

test('log is only called with "bosh" entries, never "agent" ones, when the adapter never streams any reasoning text', async () => {
  const { path: planPath, dir } = makeFile();
  const logged = [];
  await runBuildLoop({
    planPath, ...io(), say: () => {}, adapter: fakeAdapter(), repoDir: dir, runTests: passingTests,
    log: (source, text) => logged.push([source, text]),
  });
  assert.ok(!logged.some((l) => l[0] === 'agent'), 'no "agent" entry is logged when the adapter never streams any reasoning text');
});

test('log records the test gate\'s failing output when a gate fails', async () => {
  const { path: planPath, dir } = makeFile();
  const logged = [];
  await runBuildLoop({
    planPath, ...io(), say: () => {}, adapter: fakeAdapter(), repoDir: dir,
    runTests: () => ({ ok: false, output: 'boom' }),
    log: (source, text) => logged.push([source, text]),
  });
  assert.ok(logged.some((l) => l[0] === 'bosh' && l[1].includes('boom')));
});
