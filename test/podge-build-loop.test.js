import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlanItems, nextPlanItem, runBuildLoop, buildBuildLoopPrompt } from '../src/podge-build-loop.js';
import { loadModePrompt, loadBuildIntro } from '../src/prompts.js';

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

test('buildBuildLoopPrompt only prefaces build-intro.md when includeIntro is passed, and puts it above everything else', () => {
  const item = { phase: 'Core.', task: 'Implement the login screen.' };
  const withoutIntro = buildBuildLoopPrompt(item);
  const withIntro = buildBuildLoopPrompt(item, { includeIntro: true });
  assert.ok(withIntro.startsWith(loadBuildIntro().trimEnd()));
  assert.ok(withIntro.endsWith(withoutIntro));
  assert.ok(!withoutIntro.includes(loadBuildIntro().trimEnd()));
});

function makeFile() {
  const dir = mkdtempSync(join(tmpdir(), 'podge-build-loop-'));
  const path = join(dir, 'plan.md');
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

test('runBuildLoop hands every unprocessed item to the agent in turn, marking each processed once its round completes', async () => {
  const { path: planPath, dir } = makeFile();
  const adapter = fakeAdapter();
  const res = await runBuildLoop({ planPath, ...io(), say: () => {}, adapter, repoDir: dir, ...sessionStore() });
  assert.equal(res.status, 'ok');
  assert.equal(res.processed, 2);
  const after = parsePlanItems(readFileSync(planPath, 'utf8'));
  assert.equal(after[0].checked, true);
  assert.equal(after[1].checked, true);
  assert.equal(after[2].checked, true, 'already-processed item stays untouched but still checked');
  assert.equal(adapter.calls.length, 2);
  assert.match(adapter.calls[0].prompt, /## Phase\n\nHigh Level Design\.\n\n## Task\n\nEstablish architectural constraints\./);
  assert.equal(adapter.calls[0].cwd, dir);
});

test('runBuildLoop shows each item in colour with a "Thinking..." line before the agent is called', async () => {
  const { path: planPath, dir } = makeFile();
  const said = [];
  await runBuildLoop({ planPath, ...io(), say: (s) => said.push(s), adapter: fakeAdapter(), repoDir: dir, ...sessionStore() });
  assert.match(said[0], /\x1b\[1;36mPhase: High Level Design\.\x1b\[0m/);
  assert.match(said[1], /^\x1b\[90mThinking\.\.\.\x1b\[0m\n$/);
});

test('once every item is processed, a further call reports ok with nothing left to hand to the agent', async () => {
  const { path: planPath, dir } = makeFile();
  await runBuildLoop({ planPath, ...io(), say: () => {}, adapter: fakeAdapter(), repoDir: dir, ...sessionStore() });
  const adapter = fakeAdapter();
  const res = await runBuildLoop({ planPath, ...io(), say: () => {}, adapter, repoDir: dir, ...sessionStore() });
  assert.equal(res.status, 'ok');
  assert.equal(res.processed, 0);
  assert.equal(adapter.calls.length, 0);
});

test('the same session is threaded through every item, and persisted via saveSession/loadSession', async () => {
  const { path: planPath, dir } = makeFile();
  const adapter = fakeAdapter((req) => ({ session: req.session ? `${req.session}+` : 's1' }));
  const session = sessionStore();
  await runBuildLoop({ planPath, ...io(), say: () => {}, adapter, repoDir: dir, ...session });
  assert.equal(adapter.calls[0].session, undefined, 'no session yet on the very first item');
  assert.equal(adapter.calls[1].session, 's1', 'the second item resumes what the first item returned');
  assert.equal(session.store.session, 's1+', 'the final session is persisted for a future podge invocation');
});

test('build-intro.md is prefaced onto the agent prompt only on the very first item of a brand-new session, never on a later item in the same loop', async () => {
  const { path: planPath, dir } = makeFile();
  const adapter = fakeAdapter((req) => ({ session: req.session ? `${req.session}+` : 's1' }));
  await runBuildLoop({ planPath, ...io(), say: () => {}, adapter, repoDir: dir, ...sessionStore() });
  assert.ok(adapter.calls[0].prompt.startsWith(loadBuildIntro().trimEnd()), 'the first item of a brand-new session gets the intro');
  assert.ok(!adapter.calls[1].prompt.startsWith(loadBuildIntro().trimEnd()), 'the second item in the same loop does not');
});

test('build-intro.md is not re-included after a restart that resumes an already-persisted session', async () => {
  const { path: planPath, dir } = makeFile();
  const adapter = fakeAdapter();
  const session = sessionStore();
  session.store.session = 's1';
  await runBuildLoop({ planPath, ...io(), say: () => {}, adapter, repoDir: dir, ...session });
  assert.ok(!adapter.calls[0].prompt.startsWith(loadBuildIntro().trimEnd()), 'a restart resuming a persisted session never gets the intro again');
});

test('log is called once per item with the full prompt sent (\'podge\') and once with the full accumulated reasoning text (\'agent\') when the agent streams any', async () => {
  const { path: planPath, dir } = makeFile();
  /** @type {[string, string][]} */
  const logged = [];
  const adapter = fakeAdapter((req) => {
    req.onReasoning?.('step one, ');
    req.onReasoning?.('step two');
    return {};
  });
  await runBuildLoop({
    planPath, ...io(), say: () => {}, adapter, repoDir: dir,
    log: (source, text) => logged.push([source, text]), ...sessionStore(),
  });
  assert.equal(logged[0][0], 'podge');
  assert.match(logged[0][1], /## Phase\n\nHigh Level Design\.\n\n## Task\n\nEstablish architectural constraints\./);
  assert.deepEqual(logged[1], ['agent', 'step one, step two']);
});

test('log is only called with the "podge" entry, never an "agent" one, when the adapter never streams any reasoning text', async () => {
  const { path: planPath, dir } = makeFile();
  /** @type {[string, string][]} */
  const logged = [];
  await runBuildLoop({
    planPath, ...io(), say: () => {}, adapter: fakeAdapter(), repoDir: dir,
    log: (source, text) => logged.push([source, text]), ...sessionStore(),
  });
  assert.deepEqual(logged[0], ['podge', logged[0][1]]);
  assert.ok(!logged.some((l) => l[0] === 'agent'), 'no "agent" entry is logged when the adapter never streams any reasoning text');
});
