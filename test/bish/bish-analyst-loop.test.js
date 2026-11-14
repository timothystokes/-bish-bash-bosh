import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseInterview, nextQuestion, runInterviewLoop, buildInterviewLoopPrompt } from '../../src/bish/bish-analyst-loop.js';
import analystIntroPrompt from '../../src/bish/prompts/bish-analyst-intro.js';
import analystLoopPrompt from '../../src/bish/prompts/bish-analyst-loop.js';
const loadInterviewIntro = analystIntroPrompt;

const sample = [
  '# Interview',
  '',
  'This is a list of Questions (Q) and Answers (A) determined through an interview process. ',
  '',
  '1. [ ] Q: Describe the objective in a sentence. A: ',
  '2. [ ] Q: Who are the users? A: pre-filled default',
  '3. [x] Q: Already specified. A: done already',
  '',
].join('\n');

test('parseInterview reads each numbered `N. [ ] Q: ... A: ...` line, including a pre-filled but unprocessed answer', () => {
  const qs = parseInterview(sample);
  assert.equal(qs.length, 3);
  assert.deepEqual(qs[0], { id: 1, checked: false, question: 'Describe the objective in a sentence.', answer: '', lineIndex: 4 });
  assert.equal(qs[1].answer, 'pre-filled default');
  assert.equal(qs[2].checked, true);
});

test('parseInterview tolerates a parenthetical remark before the `A:` label (e.g. an agent writing "A (default):" instead of "A:")', () => {
  const qs = parseInterview('4. [ ] Q: What is in scope? A (default): Unknown; clarify before implementation.');
  assert.equal(qs.length, 1, 'the line is still recognised as a question, not silently dropped');
  assert.equal(qs[0].question, 'What is in scope?');
  assert.equal(qs[0].answer, 'Unknown; clarify before implementation.');
});

test('nextQuestion is the first line not yet checked, skipping already-processed ones', () => {
  assert.equal(nextQuestion(parseInterview(sample))?.id, 1);
  assert.equal(nextQuestion(parseInterview(sample.replace('1. [ ] Q: Describe the objective in a sentence. A: ', '1. [x] Q: Describe the objective in a sentence. A: x'))).id, 2);
});

test('buildInterviewLoopPrompt prefaces src/bish/prompts/bish-analyst-loop.js onto this round\'s question and answer', () => {
  const p = buildInterviewLoopPrompt('Describe the objective.', 'Ship a toy.');
  assert.ok(p.startsWith(analystLoopPrompt('').trimEnd()));
  assert.match(p, /## Question\n\nDescribe the objective\.\n\n## Answer\n\nShip a toy\./);
});

function makeFile() {
  const dir = mkdtempSync(join(tmpdir(), 'bish-loop-'));
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

test('an Enter with no input accepts the pre-filled default answer, writes it back, hands the round to the agent, then ticks the checkbox', async () => {
  const { path: interviewPath, dir } = makeFile();
  const say = () => {};
  let n = 0;
  const answers = ['my objective', ''];
  const ask = async () => answers[n++] ?? null;
  const adapter = fakeAdapter();
  const res = await runInterviewLoop({ interviewPath, ...io(), ask, say, adapter, repoDir: dir, ...sessionStore() });
  assert.equal(res.status, 'ok');
  assert.equal(res.answered, 2);
  const after = parseInterview(readFileSync(interviewPath, 'utf8'));
  assert.equal(after[0].answer, 'my objective');
  assert.equal(after[0].checked, true, 'ticked once the round has been handed to and processed by the agent');
  assert.equal(after[1].answer, 'pre-filled default', 'Enter alone keeps the existing default');
  assert.equal(after[1].checked, true);
  assert.equal(after[2].answer, 'done already', 'an already-processed question is untouched');
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
  assert.equal(parseInterview(readFileSync(interviewPath, 'utf8'))[0].checked, false);
  assert.equal(adapter.calls.length, 0);
});

test('the question and the prompt are shown in color, distinguishing Q from A, with any existing default passed to ask separately (for a real terminal to pre-fill in grey, not printed as bracketed text); color is reset once the answer is in, and a "Analyst thinking..." line is shown before the agent is called', async () => {
  const { path: interviewPath, dir } = makeFile();
  /** @type {string[]} */
  const said = [];
  /** @type {string[]} */
  const prompts = [];
  /** @type {(string | undefined)[]} */
  const defaults = [];
  const ask = async (p, d) => { prompts.push(p); defaults.push(d); return d === 'no' ? '' : 'x'; };
  await runInterviewLoop({ interviewPath, ...io(), ask, say: (s) => said.push(s), adapter: fakeAdapter(), repoDir: dir, ...sessionStore() });
  assert.match(said[0], /\x1b\[1;36mQ1: Describe the objective in a sentence\.\x1b\[0m/);
  assert.equal(prompts[0], '\x1b[33m', 'no label and no trailing reset: the colour alone marks the answer, and stays "active" so a pre-filled default and anything typed after it inherit it');
  assert.equal(defaults[0], '', 'no existing default for the first question');
  assert.equal(prompts[1], '\x1b[33m');
  assert.equal(defaults[1], 'pre-filled default', 'the second question\'s existing default is handed to ask, not baked into the prompt text');
  assert.equal(said[1], '\x1b[0m', 'color is reset right after each answer, so later output is not left yellow');
  assert.equal(said[2], '\x1b[90mAnalyst thinking...\n', 'a "Analyst thinking..." line, shown dim/grey, right before the agent is called, with its own trailing newline so any live reasoning text streams starting on the next line');
  assert.equal(said[3], '\x1b[0m\n', 'color is reset and the line ended once the agent call has finished');
});

test('the agent\'s own live reasoning text streams on the line after "Analyst thinking...", in the same grey, as it arrives', async () => {
  const { path: interviewPath, dir } = makeFile();
  /** @type {string[]} */
  const said = [];
  /** @type {{ calls: any[], run: (req: any) => Promise<{ exitStatus: number, transcript: string, changedFiles: string[], session?: unknown }> }} */
  const adapter = {
    calls: [],
    run: async (req) => {
      adapter.calls.push(req);
      req.onReasoning?.("I'm");
      req.onReasoning?.(' thinking this through');
      return { exitStatus: 0, transcript: '', changedFiles: [] };
    },
  };
  await runInterviewLoop({ interviewPath, ...io(), ask: answerA, say: (s) => said.push(s), adapter, repoDir: dir, ...sessionStore() });
  assert.equal(typeof adapter.calls[0].onReasoning, 'function', 'the adapter request carries an onReasoning callback');
  assert.deepEqual(said.slice(2, 5), ['\x1b[90mAnalyst thinking...\n', "I'm", ' thinking this through'], 'reasoning text is forwarded to say() plain, inheriting the grey already set by "Analyst thinking..."');
});

test('log is called once with the full prompt sent (\'bish\') and once with the full accumulated reasoning text (\'agent\'), plain text, never the Q/A/"Analyst thinking..." lines shown on screen', async () => {
  const { path: interviewPath, dir } = makeFile();
  /** @type {[string, string][]} */
  const logged = [];
  const adapter = fakeAdapter((req) => {
    req.onReasoning?.('step one, ');
    req.onReasoning?.('step two');
    return {};
  });
  await runInterviewLoop({
    interviewPath, ...io(), ask: answerA, say: () => {}, adapter, repoDir: dir,
    log: (source, text) => logged.push([source, text]), ...sessionStore(),
  });
  assert.equal(logged[0][0], 'bish/analyst prompt');
  assert.match(logged[0][1], /## Question\n\nDescribe the objective in a sentence\.\n\n## Answer\n\na/);
  assert.deepEqual(logged[1], ['bish/analyst response', 'step one, step two']);
});

test('log is only called with the "bish" entry, never an "agent" one, when the adapter never streams any reasoning text', async () => {
  const { path: interviewPath, dir } = makeFile();
  /** @type {[string, string][]} */
  const logged = [];
  const adapter = fakeAdapter();
  await runInterviewLoop({
    interviewPath, ...io(), ask: answerA, say: () => {}, adapter, repoDir: dir,
    log: (source, text) => logged.push([source, text]), ...sessionStore(),
  });
  assert.deepEqual(logged[0], ['bish/analyst prompt', logged[0][1]]);
  assert.ok(!logged.some((l) => l[0].endsWith('response')), 'no "agent" entry is logged when the adapter never streams any reasoning text');
});

test('buildInterviewLoopPrompt only prefaces bish-analyst-intro.js when includeIntro is passed, and puts it above everything else', () => {
  const withIntro = buildInterviewLoopPrompt('Q', 'A', { includeIntro: true });
  const withoutIntro = buildInterviewLoopPrompt('Q', 'A');
  assert.ok(withIntro.startsWith(loadInterviewIntro().trimEnd()));
  assert.ok(withIntro.endsWith(withoutIntro));
  assert.equal(withoutIntro.includes(loadInterviewIntro().trimEnd()), false);
});

test('bish-analyst-intro.js is prefaced onto the agent prompt only on the very first round of a brand-new session, never on a later round in the same loop', async () => {
  const { path: interviewPath, dir } = makeFile();
  const adapter = fakeAdapter((req) => ({ session: req.session ? `${req.session}+` : 's1' }));
  await runInterviewLoop({ interviewPath, ...io(), ask: answerA, say: () => {}, adapter, repoDir: dir, ...sessionStore() });
  assert.ok(adapter.calls[0].prompt.startsWith(loadInterviewIntro().trimEnd()), 'first-ever round of this session: intro included');
  assert.equal(adapter.calls[1].prompt.startsWith(loadInterviewIntro().trimEnd()), false, 'second round of the same session: no intro');
});

test('bish-analyst-intro.js is not re-included after a restart that resumes an already-persisted session', async () => {
  const { path: interviewPath, dir } = makeFile();
  const adapter = fakeAdapter();
  const session = sessionStore();
  session.store.session = 's1'; // simulates a config.yml already carrying a session from a prior invocation
  await runInterviewLoop({ interviewPath, ...io(), ask: answerA, say: () => {}, adapter, repoDir: dir, ...session });
  assert.equal(adapter.calls[0].prompt.startsWith(loadInterviewIntro().trimEnd()), false, 'a resumed session never gets the intro again, even on its first round since the restart');
});

// Answers every question with 'a', and declines the new-requirement offer that follows the last one.
const answerA = async (_p, d) => (d === 'no' ? '' : 'a');

test('once every question is answered, a call only offers a new requirement (default no) and does nothing on Enter', async () => {
  const { path: interviewPath, dir } = makeFile();
  await runInterviewLoop({ interviewPath, ...io(), ask: answerA, say: () => {}, adapter: fakeAdapter(), repoDir: dir, ...sessionStore() });
  const before = readFileSync(interviewPath, 'utf8');
  const adapter = fakeAdapter();
  const asked = [];
  const said = [];
  const res = await runInterviewLoop({ interviewPath, ...io(), ask: async (p, d) => { asked.push(d); return ''; }, say: (s) => said.push(s), adapter, repoDir: dir, ...sessionStore() });
  assert.equal(res.status, 'ok');
  assert.equal(res.answered, 0);
  assert.deepEqual(asked, ['no']);
  assert.match(said.join(''), /All questions have been answered but would you like to describe a new requirement\?/);
  assert.equal(adapter.calls.length, 0);
  assert.equal(readFileSync(interviewPath, 'utf8'), before);
});

test('an answer to the new-requirement offer is appended as a question and handed to the agent like any other', async () => {
  const { path: interviewPath, dir } = makeFile();
  await runInterviewLoop({ interviewPath, ...io(), ask: answerA, say: () => {}, adapter: fakeAdapter(), repoDir: dir, ...sessionStore() });
  const adapter = fakeAdapter();
  const replies = ['Add a dark mode', ''];
  const messages = [];
  const res = await runInterviewLoop({ interviewPath, ...io(), ask: async () => replies.shift(), say: () => {}, adapter, repoDir: dir, ...sessionStore(), commit: (m) => messages.push(m) });
  assert.equal(res.status, 'ok');
  assert.equal(res.answered, 1);
  assert.equal(adapter.calls.length, 1);
  assert.match(adapter.calls[0].prompt, /would you like to describe a new requirement\?\n\n## Answer\n\nAdd a dark mode/);
  assert.match(readFileSync(interviewPath, 'utf8'), /\[x\] Q: All questions have been answered but would you like to describe a new requirement\? A: Add a dark mode/);
  assert.equal(messages.length, 1);
});

test('the same session is threaded through every round, and persisted via saveSession/loadSession', async () => {
  const { path: interviewPath, dir } = makeFile();
  const adapter = fakeAdapter((req) => ({ session: req.session ? `${req.session}+` : 's1' }));
  const session = sessionStore();
  await runInterviewLoop({ interviewPath, ...io(), ask: answerA, say: () => {}, adapter, repoDir: dir, ...session });
  assert.equal(adapter.calls[0].session, undefined, 'no session yet on the very first round');
  assert.equal(adapter.calls[1].session, 's1', 'the second round resumes what the first round returned');
  assert.equal(session.store.session, 's1+', 'the final session is persisted for a future bish invocation');
});

test('the harness commits after each completed round, with the question and answer as the message', async () => {
  const { path: interviewPath, dir } = makeFile();
  const answers = ['my objective', ''];
  let n = 0;
  const messages = [];
  await runInterviewLoop({ interviewPath, ...io(), ask: async () => answers[n++] ?? null, say: () => {}, adapter: fakeAdapter(), repoDir: dir, ...sessionStore(), commit: (m) => messages.push(m) });
  assert.deepEqual(messages, [
    'bish: Describe the objective in a sentence.\n\nAnswer: my objective',
    'bish: Who are the users?\n\nAnswer: pre-filled default',
  ]);
});
