import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseQuestions, nextQuestion, runInterviewLoop, buildInterviewLoopPrompt } from '../src/hodge-interview-loop.js';
import { loadModePrompt } from '../src/prompts.js';

const sample = [
  '# Interview',
  '',
  'This is a list of Questions (Q) and Answers (A) determined through an interview process. ',
  '',
  '# 1',
  '[ ] Q: Describe the objective in a sentence.',
  '[ ] A: ',
  '',
  '# 2',
  '[ ] Q: Who are the users?',
  '[ ] A: pre-filled default',
  '',
  '# 3',
  '[x] Q: Already specified.',
  '[x] A: done already',
  '',
].join('\n');

test('parseQuestions reads each # N / Q / A block, including a pre-filled but unchecked answer', () => {
  const qs = parseQuestions(sample);
  assert.equal(qs.length, 3);
  assert.deepEqual(qs[0], { id: 1, qChecked: false, question: 'Describe the objective in a sentence.', aChecked: false, answer: '', aLineIndex: 6 });
  assert.equal(qs[1].answer, 'pre-filled default');
  assert.equal(qs[2].qChecked, true);
  assert.equal(qs[2].aChecked, true);
});

test('nextQuestion is the first block with neither checkbox checked, skipping already-specified ones', () => {
  assert.equal(nextQuestion(parseQuestions(sample))?.id, 1);
  assert.equal(nextQuestion(parseQuestions(sample.replace('# 1\n[ ] Q: Describe the objective in a sentence.\n[ ] A: ', '# 1\n[x] Q: Describe the objective in a sentence.\n[x] A: x'))).id, 2);
});

test('buildInterviewLoopPrompt prefaces prompts/interview-loop.md onto this round\'s question and answer', () => {
  const p = buildInterviewLoopPrompt('Describe the objective.', 'Ship a toy.');
  assert.ok(p.startsWith(loadModePrompt('interview')));
  assert.match(p, /## Question\n\nDescribe the objective\.\n\n## Answer\n\nShip a toy\./);
});

function makeFile() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-loop-'));
  const path = join(dir, 'interview.md');
  writeFileSync(path, sample);
  return { path, dir };
}

const io = () => ({ readFile: (p) => readFileSync(p, 'utf8'), writeFile: (p, s) => writeFileSync(p, s) });

// A scripted fake adapter: records every prompt/session it was called with and returns a fixed
// (or per-call, via a function) result. `session` defaults to echoing back whatever it was given,
// so a test can thread one fake "conversation" through several calls without a real adapter.
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

test('an Enter with no input accepts the pre-filled default answer, checks the A box, then hands the round to the agent and checks the Q box too', async () => {
  const { path: interviewPath, dir } = makeFile();
  const say = () => {};
  let n = 0;
  const answers = ['my objective', ''];
  const ask = async () => answers[n++] ?? null;
  const adapter = fakeAdapter();
  const res = await runInterviewLoop({ interviewPath, ...io(), ask, say, adapter, repoDir: dir, ...sessionStore() });
  assert.equal(res.status, 'ok');
  assert.equal(res.answered, 2);
  const after = parseQuestions(readFileSync(interviewPath, 'utf8'));
  assert.equal(after[0].answer, 'my objective');
  assert.equal(after[0].aChecked, true);
  assert.equal(after[0].qChecked, true, 'ticked once the round has been handed to the agent');
  assert.equal(after[1].answer, 'pre-filled default', 'Enter alone keeps the existing default');
  assert.equal(after[1].aChecked, true);
  assert.equal(after[1].qChecked, true);
  assert.equal(after[2].answer, 'done already', 'an already-answered question is untouched');
  assert.equal(adapter.calls.length, 2);
  assert.match(adapter.calls[0].prompt, /## Question\n\nDescribe the objective in a sentence\.\n\n## Answer\n\nmy objective/);
  assert.equal(adapter.calls[0].cwd, dir);
});

test('EOF (null from ask) pauses without marking the current question or calling the agent, reporting how many remain', async () => {
  const { path: interviewPath, dir } = makeFile();
  const adapter = fakeAdapter();
  const res = await runInterviewLoop({ interviewPath, ...io(), ask: async () => null, say: () => {}, adapter, repoDir: dir, ...sessionStore() });
  assert.equal(res.status, 'paused');
  assert.equal(res.answered, 0);
  assert.equal(res.remaining, 2);
  assert.equal(parseQuestions(readFileSync(interviewPath, 'utf8'))[0].aChecked, false);
  assert.equal(adapter.calls.length, 0);
});

test('the question and the prompt are shown in color, distinguishing Q from A, with any existing default passed to ask separately (for a real terminal to pre-fill in grey, not printed as bracketed text); color is reset once the answer is in, and a "Thinking..." line is shown before the agent is called', async () => {
  const { path: interviewPath, dir } = makeFile();
  /** @type {string[]} */
  const said = [];
  /** @type {string[]} */
  const prompts = [];
  /** @type {(string | undefined)[]} */
  const defaults = [];
  const ask = async (p, d) => { prompts.push(p); defaults.push(d); return 'x'; };
  await runInterviewLoop({ interviewPath, ...io(), ask, say: (s) => said.push(s), adapter: fakeAdapter(), repoDir: dir, ...sessionStore() });
  assert.match(said[0], /\x1b\[1;36mQ: Describe the objective in a sentence\.\x1b\[0m/);
  assert.match(prompts[0], /^\x1b\[33mA: $/, 'no trailing reset: the prompt stays "active" so a pre-filled default and anything typed after it inherit the same color');
  assert.equal(defaults[0], '', 'no existing default for the first question');
  assert.match(prompts[1], /^\x1b\[33mA: $/);
  assert.equal(defaults[1], 'pre-filled default', 'the second question\'s existing default is handed to ask, not baked into the prompt text');
  assert.equal(said[1], '\x1b[0m', 'color is reset right after each answer, so later output is not left yellow');
  assert.match(said[2], /^\x1b\[90mThinking\.\.\.\x1b\[0m\n$/, 'a "Thinking..." line, shown dim/grey, on its own line, right before the agent is called');
});

test('once every question is answered, a further call reports ok with nothing left to ask or hand to the agent', async () => {
  const { path: interviewPath, dir } = makeFile();
  await runInterviewLoop({ interviewPath, ...io(), ask: async () => 'a', say: () => {}, adapter: fakeAdapter(), repoDir: dir, ...sessionStore() });
  const adapter = fakeAdapter();
  const res = await runInterviewLoop({ interviewPath, ...io(), ask: async () => { throw new Error('must not ask again'); }, say: () => {}, adapter, repoDir: dir, ...sessionStore() });
  assert.equal(res.status, 'ok');
  assert.equal(res.answered, 0);
  assert.equal(adapter.calls.length, 0);
});

test('the same session is threaded through every round, and persisted via saveSession/loadSession', async () => {
  const { path: interviewPath, dir } = makeFile();
  const adapter = fakeAdapter((req) => ({ session: req.session ? `${req.session}+` : 's1' }));
  const session = sessionStore();
  await runInterviewLoop({ interviewPath, ...io(), ask: async () => 'a', say: () => {}, adapter, repoDir: dir, ...session });
  assert.equal(adapter.calls[0].session, undefined, 'no session yet on the very first round');
  assert.equal(adapter.calls[1].session, 's1', 'the second round resumes what the first round returned');
  assert.equal(session.store.session, 's1+', 'the final session is persisted for a future hodge invocation');
});
