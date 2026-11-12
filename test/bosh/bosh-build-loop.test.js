import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlanItems, nextPlanItem, runBuildLoop, buildTestLoopPrompt, buildBuildLoopPrompt, buildQaLoopPrompt, MAX_ATTEMPTS } from '../../src/bosh/bosh-build-loop.js';
import { loadModePrompt } from '../../src/shared/prompts.js';

const sample = [
  '# Plan',
  '',
  '1. [ ] Phase: High Level Design. Task: Establish architectural constraints. Depends: None',
  '2. [ ] Phase: Core. Task: Implement the login screen. Depends: 1',
  '3. [x] Phase: Done already. Task: Already implemented. Depends: None',
  '',
].join('\n');

test('parsePlanItems reads each numbered `N. [ ] Phase: ... Task: ... Depends: ...` line', () => {
  const items = parsePlanItems(sample);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { id: 1, checked: false, phase: 'High Level Design.', task: 'Establish architectural constraints.', dependsOn: [], lineIndex: 2 });
  assert.equal(items[1].task, 'Implement the login screen.');
  assert.deepEqual(items[1].dependsOn, [1]);
  assert.equal(items[2].checked, true);
});

test('nextPlanItem is the first item not yet checked, skipping already-processed ones', () => {
  assert.equal(nextPlanItem(parsePlanItems(sample))?.phase, 'High Level Design.');
  assert.equal(nextPlanItem(parsePlanItems(sample.replace('1. [ ] Phase: High Level Design.', '1. [x] Phase: High Level Design.')))?.phase, 'Core.');
});

test('parsePlanItems reads a multi-number Depends list, treats a missing or None Depends as no dependencies', () => {
  const items = parsePlanItems('4. [ ] Phase: P. Task: T. Depends: 1, 3\n5. [ ] Phase: P. Task: No depends label.\n');
  assert.deepEqual(items.map((i) => i.dependsOn), [[1, 3], []]);
  assert.equal(items[1].task, 'No depends label.');
});

test('nextPlanItem skips an unticked item whose dependencies are not all ticked, taking a later ready one first', () => {
  const items = parsePlanItems('1. [ ] Phase: A. Task: a. Depends: 2\n2. [ ] Phase: B. Task: b. Depends: None\n');
  assert.equal(nextPlanItem(items).id, 2);
  assert.equal(nextPlanItem(parsePlanItems('1. [ ] Phase: A. Task: a. Depends: 2\n2. [x] Phase: B. Task: b. Depends: None\n')).id, 1);
});

function makeFile(text = sample) {
  const dir = mkdtempSync(join(tmpdir(), 'bosh-build-loop-'));
  const path = join(dir, 'plan.md');
  writeFileSync(path, text);
  return { path, dir };
}

const io = () => ({ readFile: (p) => readFileSync(p, 'utf8'), writeFile: (p, s) => writeFileSync(p, s) });

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

// Fake harness: every listTests call reports a changed test file (as if the agent wrote one), a run of
// only the touched files is red, and a full run is green, unless overridden.
function harness(over = {}) {
  let stamp = 0;
  return {
    listTests: () => new Map([['/t/a.test.js', String(stamp++)]]),
    runTests: ({ files }) => (files ? { ok: false, output: 'red' } : { ok: true, output: '' }),
    ...over,
  };
}

const run = (planPath, dir, adapter, extra = {}) =>
  runBuildLoop({ planPath, ...io(), say: () => {}, adapter, repoDir: dir, ...harness(), ...extra });

test('runBuildLoop builds a dependency before its dependent, ticks only the checkbox, and reports blocked on a dependency cycle', async () => {
  const { path, dir } = makeFile('1. [ ] Phase: A. Task: first. Depends: 2\n2. [ ] Phase: B. Task: second. Depends: None\n');
  const adapter = fakeAdapter();
  const res = await run(path, dir, adapter);
  assert.equal(res.status, 'ok');
  assert.match(adapter.calls[0].prompt, /## Task\n\nsecond\./, 'the dependency is built first');
  assert.equal(readFileSync(path, 'utf8'), '1. [x] Phase: A. Task: first. Depends: 2\n2. [x] Phase: B. Task: second. Depends: None\n');
  writeFileSync(path, '1. [ ] Phase: A. Task: a. Depends: 2\n2. [ ] Phase: B. Task: b. Depends: 1\n');
  const blocked = await run(path, dir, fakeAdapter());
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.output, /1 needs 2; 2 needs 1/);
});

for (const [name, build, mode] of [
  ['buildTestLoopPrompt', buildTestLoopPrompt, 'test-loop'],
  ['buildBuildLoopPrompt', buildBuildLoopPrompt, 'build-loop'],
  ['buildQaLoopPrompt', buildQaLoopPrompt, 'qa-loop'],
]) {
  test(`${name} prefaces its mode prompt onto the item's phase and task, and tail-truncates a long previous failure`, () => {
    const p = build({ phase: 'Core.', task: 'Implement the login screen.' });
    assert.ok(p.startsWith(loadModePrompt(mode)));
    assert.match(p, /## Phase\n\nCore\.\n\n## Task\n\nImplement the login screen\./);
    assert.doesNotMatch(p, /\n\n## Previous Failure/);
    const long = build({ phase: 'P', task: 'T' }, `${'x'.repeat(10000)}END`);
    assert.ok(long.endsWith('xEND'));
    assert.ok(long.length < loadModePrompt(mode).length + 4200);
  });
}

test('each item runs three fresh-context steps in order: write tests, implement, verify; then ticks, for every item', async () => {
  const { path, dir } = makeFile();
  const adapter = fakeAdapter();
  const res = await run(path, dir, adapter);
  assert.equal(res.status, 'ok');
  assert.equal(res.processed, 2);
  const after = parsePlanItems(readFileSync(path, 'utf8'));
  assert.ok(after.every((i) => i.checked));
  assert.equal(adapter.calls.length, 6, 'three agent calls per item, two items');
  assert.ok(adapter.calls[0].prompt.startsWith(loadModePrompt('test-loop')));
  assert.ok(adapter.calls[1].prompt.startsWith(loadModePrompt('build-loop')));
  assert.ok(adapter.calls[2].prompt.startsWith(loadModePrompt('qa-loop')));
  assert.match(adapter.calls[0].prompt, /## Task\n\nEstablish architectural constraints\./);
  assert.equal(adapter.calls[0].cwd, dir);
  for (const call of adapter.calls) assert.ok(!Object.hasOwn(call, 'session'), 'no call opts into session tracking');
});

test('the red check runs only the new or changed test files; the green check runs the full suite', async () => {
  const { path, dir } = makeFile('1. [ ] Phase: A. Task: a. Depends: None\n');
  const runs = [];
  await run(path, dir, fakeAdapter(), { runTests: (o) => { runs.push(o.files); return o.files ? { ok: false, output: 'red' } : { ok: true, output: '' }; } });
  assert.deepEqual(runs, [['/t/a.test.js'], undefined, undefined]);
});

test('a test step that adds or changes no test file is retried with that feedback, and the item fails after the cap', async () => {
  const { path, dir } = makeFile();
  const adapter = fakeAdapter();
  const res = await run(path, dir, adapter, { listTests: () => new Map([['/t/a.test.js', '1']]) });
  assert.equal(res.status, 'failed');
  assert.match(res.output, /No test file .* was added or changed/);
  assert.equal(adapter.calls.length, MAX_ATTEMPTS, 'only the test step ran, retried up to the cap');
  assert.match(adapter.calls[1].prompt, /## Previous Failure\n\nNo test file/);
  assert.equal(parsePlanItems(readFileSync(path, 'utf8'))[0].checked, false);
});

test('new tests that already pass are rejected (must be red before implementing), then accepted on a retry that makes them fail', async () => {
  const { path, dir } = makeFile('1. [ ] Phase: A. Task: a. Depends: None\n');
  let reds = 0;
  const adapter = fakeAdapter();
  const res = await run(path, dir, adapter, {
    runTests: ({ files }) => (files ? (++reds === 1 ? { ok: true, output: 'all green' } : { ok: false, output: 'red' }) : { ok: true, output: '' }),
  });
  assert.equal(res.status, 'ok');
  assert.ok(adapter.calls[1].prompt.startsWith(loadModePrompt('test-loop')), 'the test step is retried');
  assert.match(adapter.calls[1].prompt, /## Previous Failure\n\nThe new tests .* already pass before any implementation[\s\S]*all green/);
  assert.ok(adapter.calls[2].prompt.startsWith(loadModePrompt('build-loop')), 'only then does the implement step start');
});

test('a red implement step is retried with the failing output, then the item fails after the cap and QA never runs', async () => {
  const { path, dir } = makeFile();
  const adapter = fakeAdapter();
  let full = 0;
  const res = await run(path, dir, adapter, {
    runTests: ({ files }) => (files ? { ok: false, output: 'red' } : { ok: false, output: `boom ${++full}` }),
  });
  assert.equal(res.status, 'failed');
  assert.equal(res.output, `boom ${MAX_ATTEMPTS}`);
  assert.equal(adapter.calls.length, 1 + MAX_ATTEMPTS);
  assert.match(adapter.calls[2].prompt, /## Previous Failure\n\nboom 1$/);
  assert.ok(adapter.calls.every((c, i) => i === 0 || c.prompt.startsWith(loadModePrompt('build-loop'))));
  assert.equal(parsePlanItems(readFileSync(path, 'utf8'))[0].checked, false);
});

test('a verify call that throws is retried with the error in its prompt, and the item is ticked once a retry succeeds', async () => {
  const { path, dir } = makeFile();
  const adapter = fakeAdapter((req, n) => {
    if (n === 3) throw new Error('adapter exploded');
    return {};
  });
  const res = await run(path, dir, adapter);
  assert.equal(res.status, 'ok');
  assert.equal(res.processed, 2);
  assert.match(adapter.calls[3].prompt, /## Previous Failure\n\nVerifying step threw an error: adapter exploded/);
  assert.ok(adapter.calls[3].prompt.startsWith(loadModePrompt('qa-loop')));
});

test('a failing suite after verify is retried with its output, then reported after the cap, leaving the item unticked', async () => {
  const { path, dir } = makeFile();
  const adapter = fakeAdapter();
  let full = 0;
  const res = await run(path, dir, adapter, {
    runTests: ({ files }) => (files ? { ok: false, output: 'red' } : ++full === 1 ? { ok: true, output: '' } : { ok: false, output: `red ${full}` }),
  });
  assert.equal(res.status, 'failed');
  assert.equal(res.output, `red ${1 + MAX_ATTEMPTS}`);
  assert.match(adapter.calls[3].prompt, /## Previous Failure\n\nred 2$/);
  assert.equal(parsePlanItems(readFileSync(path, 'utf8'))[0].checked, false);
});

test('shows each item in colour with a grey status line before each step', async () => {
  const { path, dir } = makeFile();
  const said = [];
  await run(path, dir, fakeAdapter(), { say: (s) => said.push(s) });
  assert.match(said[0], /\x1b\[1;36mPhase: High Level Design\.\x1b\[0m/);
  assert.match(said[1], /^\x1b\[90mWriting tests\.\.\.\x1b\[0m\n$/);
  assert.match(said[2], /^\x1b\[90mImplementing\.\.\.\x1b\[0m\n$/);
  assert.match(said[3], /^\x1b\[90mVerifying\.\.\.\x1b\[0m\n$/);
});

test('once every item is processed, a further call reports ok with nothing left to hand to the agent; a failed item is retried from its first step next run', async () => {
  const { path, dir } = makeFile();
  await run(path, dir, fakeAdapter(), { runTests: () => ({ ok: false, output: 'boom' }) });
  const adapter = fakeAdapter();
  const res = await run(path, dir, adapter);
  assert.equal(res.processed, 2);
  assert.match(adapter.calls[0].prompt, /Establish architectural constraints\./);
  assert.ok(adapter.calls[0].prompt.startsWith(loadModePrompt('test-loop')));
  const again = fakeAdapter();
  assert.deepEqual(await run(path, dir, again), { status: 'ok', processed: 0, total: 3 });
  assert.equal(again.calls.length, 0);
});

test('log gets each full prompt (\'bosh\'), streamed reasoning (\'agent\') only when streamed, and failure output when a gate fails', async () => {
  const { path, dir } = makeFile('1. [ ] Phase: A. Task: a. Depends: None\n');
  const logged = [];
  await run(path, dir, fakeAdapter((req) => { req.onReasoning?.('step one, '); req.onReasoning?.('step two'); return {}; }), { log: (s, t) => logged.push([s, t]) });
  assert.equal(logged[0][0], 'bosh/tester prompt');
  assert.ok(logged[0][1].startsWith(loadModePrompt('test-loop')));
  assert.deepEqual(logged[1], ['bosh/tester response', 'step one, step two']);
  assert.deepEqual(logged.filter((l) => l[0].endsWith('prompt')).map((l) => l[0]), ['bosh/tester prompt', 'bosh/builder prompt', 'bosh/verifier prompt'], 'each fresh-context step is logged under its own persona');
  const quiet = [];
  await run(path, dir, fakeAdapter(), { log: (s, t) => quiet.push([s, t]) });
  assert.ok(!quiet.some((l) => l[0].endsWith('response')));
  const failing = [];
  const { path: p2, dir: d2 } = makeFile();
  await run(p2, d2, fakeAdapter(), { runTests: () => ({ ok: false, output: 'boom' }), log: (s, t) => failing.push([s, t]) });
  assert.ok(failing.some((l) => l[0] === 'bosh/harness' && l[1].includes('boom')));
});

test('parsePlanItems reads the short P/T/S/D line format as well as the long labels', () => {
  const items = parsePlanItems([
    '1. [ ] P: Core T: Make the board - detail. S: Q1, Q2 D: None',
    '2. [x] P: Core T: Pick moves S: Q1 D: 1, 3',
    '3. [ ] Phase: Core Task: Old style Depends: 1',
  ].join('\n'));
  assert.deepEqual(items.map((i) => [i.id, i.checked, i.phase, i.task, i.dependsOn]), [
    [1, false, 'Core', 'Make the board - detail.', []],
    [2, true, 'Core', 'Pick moves', [1, 3]],
    [3, false, 'Core', 'Old style', [1]],
  ]);
});

test('tests that still pass on the retry are accepted (the item was implemented by an earlier interrupted run) and the loop carries on', async () => {
  const { path, dir } = makeFile('1. [ ] Phase: A. Task: a. Depends: None\n');
  const adapter = fakeAdapter();
  const res = await run(path, dir, adapter, { runTests: () => ({ ok: true, output: 'all green' }) });
  assert.equal(res.status, 'ok');
  assert.equal(adapter.calls.filter((c) => c.prompt.startsWith(loadModePrompt('test-loop'))).length, 2);
  assert.ok(adapter.calls.some((c) => c.prompt.startsWith(loadModePrompt('build-loop'))));
});
