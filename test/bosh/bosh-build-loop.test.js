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
  '1. [ ] T: Establish architectural constraints',
  '2. [ ] T: Implement the login screen',
  '3. [x] T: Already implemented',
  '',
].join('\n');

test('parsePlanItems reads each numbered `N. [ ] T: <name> - <detail> S: <ids>` line', () => {
  const items = parsePlanItems(sample);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { id: 1, checked: false, task: 'Establish architectural constraints', specs: [], lineIndex: 2 });
  assert.equal(items[1].task, 'Implement the login screen');
  assert.equal(items[2].checked, true);
  assert.deepEqual(parsePlanItems('1. [ ] T: Make the board - detail. S: 1, 12\n2. [x] T: Pick moves').map((i) => [i.id, i.checked, i.task, i.specs]), [
    [1, false, 'Make the board - detail.', [1, 12]],
    [2, true, 'Pick moves', []],
  ]);
});

test('nextPlanItem is the first item not yet checked, in file order', () => {
  assert.equal(nextPlanItem(parsePlanItems(sample))?.id, 1);
  assert.equal(nextPlanItem(parsePlanItems(sample.replace('1. [ ]', '1. [x]')))?.id, 2);
  assert.equal(nextPlanItem(parsePlanItems('1. [x] T: a\n')), null);
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

test('runBuildLoop builds items in plan order and ticks only the checkbox', async () => {
  const { path, dir } = makeFile('1. [ ] T: first\n2. [ ] T: second\n');
  const adapter = fakeAdapter();
  const res = await run(path, dir, adapter);
  assert.equal(res.status, 'ok');
  assert.match(adapter.calls[0].prompt, /## Task\n\nfirst/, 'the first line is built first');
  assert.equal(readFileSync(path, 'utf8'), '1. [x] T: first\n2. [x] T: second\n');
});

for (const [name, build, mode] of [
  ['buildTestLoopPrompt', buildTestLoopPrompt, 'test-loop'],
  ['buildBuildLoopPrompt', buildBuildLoopPrompt, 'build-loop'],
  ['buildQaLoopPrompt', buildQaLoopPrompt, 'qa-loop'],
]) {
  test(`${name} prefaces its mode prompt onto the item's task, and tail-truncates a long previous failure`, () => {
    const p = build({ task: 'Implement the login screen.' });
    assert.ok(p.startsWith(loadModePrompt(mode)));
    assert.match(p, /## Task\n\nImplement the login screen\./);
    assert.doesNotMatch(p, /\n\n## Previous Failure/);
    const long = build({ task: 'T' }, `${'x'.repeat(10000)}END`);
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
  assert.match(adapter.calls[0].prompt, /## Task\n\nEstablish architectural constraints/);
  assert.equal(adapter.calls[0].cwd, dir);
  for (const call of adapter.calls) assert.ok(!Object.hasOwn(call, 'session'), 'no call opts into session tracking');
});

test('the red check runs only the new or changed test files; the green check runs the full suite', async () => {
  const { path, dir } = makeFile('1. [ ] T: a\n');
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
  const { path, dir } = makeFile('1. [ ] T: a\n');
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
  assert.match(said[0], /\x1b\[1;36mEstablish architectural constraints\x1b\[0m/);
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
  assert.match(adapter.calls[0].prompt, /Establish architectural constraints/);
  assert.ok(adapter.calls[0].prompt.startsWith(loadModePrompt('test-loop')));
  const again = fakeAdapter();
  assert.deepEqual(await run(path, dir, again), { status: 'ok', processed: 0, total: 3, spec: undefined });
  assert.equal(again.calls.length, 0);
});

test('log gets each full prompt (\'bosh\'), streamed reasoning (\'agent\') only when streamed, and failure output when a gate fails', async () => {
  const { path, dir } = makeFile('1. [ ] T: a\n');
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

test('tests that still pass on the retry are accepted (the item was implemented by an earlier interrupted run) and the loop carries on', async () => {
  const { path, dir } = makeFile('1. [ ] T: a\n');
  const adapter = fakeAdapter();
  const res = await run(path, dir, adapter, { runTests: () => ({ ok: true, output: 'all green' }) });
  assert.equal(res.status, 'ok');
  assert.equal(adapter.calls.filter((c) => c.prompt.startsWith(loadModePrompt('test-loop'))).length, 2);
  assert.ok(adapter.calls.some((c) => c.prompt.startsWith(loadModePrompt('build-loop'))));
});

test('the plan item\'s S: ids reach the tester prompt, and a green full run ticks only spec items whose tagged tests all pass', async () => {
  const { path, dir } = makeFile('1. [ ] T: a S: 1, 2\n');
  const specPath = join(dir, 'specification.md');
  writeFileSync(specPath, '1. [ ] C: one. B: x\n2. [ ] C: two. B: y\n3. [ ] C: three. B: z\n');
  const adapter = fakeAdapter();
  const output = '✔ [S1] works (2ms)\n✔ [S2, S1] also (1ms)\n✖ [S2] breaks (1ms)\nℹ pass 2\n';
  const res = await run(path, dir, adapter, { specPath, runTests: ({ files }) => ({ ok: !!files ? false : true, output }) });
  assert.match(adapter.calls[0].prompt, /## Specification ids\n\n1, 2/);
  assert.equal(res.status, 'ok');
  assert.deepEqual(res.spec, { verified: [1], failing: [2], uncovered: [3] });
  assert.equal(readFileSync(specPath, 'utf8'), '1. [x] C: one. B: x\n2. [ ] C: two. B: y\n3. [ ] C: three. B: z\n');
});

test('the harness commits once per completed item, with the task and its specification ids as the message', async () => {
  const { path, dir } = makeFile('1. [ ] T: Create index.html - the page shell S: 2, 3\n2. [ ] T: Style the grid\n');
  const messages = [];
  await run(path, dir, fakeAdapter(), { commit: (m) => messages.push(m) });
  assert.equal(messages.length, 2);
  assert.match(messages[0], /^bosh: Create index\.html\n\nthe page shell\n\nSpecification items: 2, 3/);
  assert.match(messages[1], /^bosh: Style the grid/);
  const failed = [];
  await run(path, dir, fakeAdapter(), { runTests: () => ({ ok: false, output: 'x' }), commit: (m) => failed.push(m) });
  assert.deepEqual(failed, [], 'nothing is committed for an item that did not pass');
});
