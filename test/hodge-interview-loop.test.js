import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseQuestions, nextQuestion, runInterviewLoop } from '../src/hodge-interview-loop.js';

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

function makeFile() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-loop-'));
  const path = join(dir, 'interview.md');
  writeFileSync(path, sample);
  return path;
}

const io = () => ({ readFile: (p) => readFileSync(p, 'utf8'), writeFile: (p, s) => writeFileSync(p, s) });

test('an Enter with no input accepts the pre-filled default answer and checks only the A box', async () => {
  const interviewPath = makeFile();
  const say = () => {};
  let n = 0;
  const answers = ['my objective', ''];
  const ask = async () => answers[n++] ?? null;
  const res = await runInterviewLoop({ interviewPath, ...io(), ask, say });
  assert.equal(res.status, 'ok');
  assert.equal(res.answered, 2);
  const after = parseQuestions(readFileSync(interviewPath, 'utf8'));
  assert.equal(after[0].answer, 'my objective');
  assert.equal(after[0].aChecked, true);
  assert.equal(after[0].qChecked, false, 'the Q checkbox is left for a later step');
  assert.equal(after[1].answer, 'pre-filled default', 'Enter alone keeps the existing default');
  assert.equal(after[1].aChecked, true);
  assert.equal(after[2].answer, 'done already', 'an already-answered question is untouched');
});

test('EOF (null from ask) pauses without marking the current question, reporting how many remain', async () => {
  const interviewPath = makeFile();
  const res = await runInterviewLoop({ interviewPath, ...io(), ask: async () => null, say: () => {} });
  assert.equal(res.status, 'paused');
  assert.equal(res.answered, 0);
  assert.equal(res.remaining, 2);
  assert.equal(parseQuestions(readFileSync(interviewPath, 'utf8'))[0].aChecked, false);
});

test('the question and the prompt are shown in color, distinguishing Q from A', async () => {
  const interviewPath = makeFile();
  /** @type {string[]} */
  const said = [];
  /** @type {string[]} */
  const prompts = [];
  const ask = async (p) => { prompts.push(p); return 'x'; };
  await runInterviewLoop({ interviewPath, ...io(), ask, say: (s) => said.push(s) });
  assert.match(said[0], /\x1b\[1;36mQ: Describe the objective in a sentence\.\x1b\[0m/);
  assert.match(prompts[0], /\x1b\[33mA: \x1b\[0m/);
  assert.match(prompts[1], /\x1b\[33mA: \[pre-filled default\] \x1b\[0m/);
});

test('once every question is answered, a further call reports ok with nothing left to ask', async () => {
  const interviewPath = makeFile();
  await runInterviewLoop({ interviewPath, ...io(), ask: async () => 'a', say: () => {} });
  const res = await runInterviewLoop({ interviewPath, ...io(), ask: async () => { throw new Error('must not ask again'); }, say: () => {} });
  assert.equal(res.status, 'ok');
  assert.equal(res.answered, 0);
});
