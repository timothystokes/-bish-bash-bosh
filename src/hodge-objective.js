import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { hasObjectiveKit } from './readiness.js';
import { runInterview } from './hodge-interview.js';
import { BATCH_HINT, formatBatchLog, nextBatch, readQuestions, recordAnswers, renderBatch, resolveAnswer, unanswered, writeQuestions } from './hodge-questions.js';
import { LOCK_FILE } from './run-lock.js';

const ENDED = 'Ended the interview: the owner said done.';
const isDone = (a) => /^(done|finished)$/i.test(a);

// Q1 is the objective description, bootstrapped once and never re-asked: it is already "specified" (nothing to
// derive a spec from) but stays visible to the agent every round as persistent context (see `objectiveOf`).
const objectiveOf = (qs) => qs.find((q) => q.id === 1)?.answer ?? '';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

// Requirements gathering: ask for a description of the objective, then alternate agent rounds
// (which update specs and write one next question) with the owner's answers, broad first and fine-grained
// later, until `hodgepodge ready` passes. Everything lives in the target repo, so a paused conversation resumes.
export async function runObjective({ config, repoDir, runId, adapter, ask, say, maxRounds = 30, inboxDir = undefined, identity = undefined }) {
  const gated = (reason) => ({ status: 'gated', rounds: 0, reason });
  if (!hasObjectiveKit(repoDir)) return gated('no objective kit in the project (run `hodge` once; it adds objective/ automatically)');
  // `.hodge.lock` lives in the project root now (no separate sandbox dir); exclude it from the
  // dirty-working-tree check since it is harness-internal, never committed.
  if (git(repoDir, 'status', '--porcelain', '--', '.', `:!${LOCK_FILE}`).trim() !== '') return gated('working tree is not clean');

  let qs = readQuestions(repoDir);
  let brief = objectiveOf(qs);
  if (brief.trim() === '') {
    const description = (await ask('Describe the objective in a sentence or two: what should exist when this is done, and why?\n> ') ?? '').trim();
    if (description === '') return gated('no objective description given');
    brief = description;
    qs = [{ id: 1, topic: 'objective', text: 'Describe the objective in a sentence or two: what should exist when this is done, and why?', default: '', answer: brief, specified: true }];
    writeQuestions(repoDir, qs);
    git(repoDir, 'add', '-A', '--', '.', `:!${LOCK_FILE}`);
    git(repoDir, 'commit', '-q', '-m', 'hodge: objective');
  }

  const runDir = join(repoDir, 'runs', runId);
  let round = (existsSync(runDir) ? readdirSync(runDir).filter((d) => /^interview(-\d+)?$/.test(d)).length : 0) + 1;
  let ran = 0;
  let lastStall = '';
  let note = '';
  const conversationPath = join(repoDir, 'objective', 'CONVERSATION.md');
  // Once the owner ends the interview (or no question is left), rounds check readiness and close the gaps.
  let closing = existsSync(conversationPath) && readFileSync(conversationPath, 'utf8').includes(ENDED);

  const askBatch = async () => {
    const qs = readQuestions(repoDir);
    const batch = nextBatch(qs);
    if (batch.length === 0) return true;
    say(`\n${renderBatch(batch)}\n(${BATCH_HINT})\n`);
    let answers;
    for (;;) {
      const reply = (await ask('> ') ?? '').trim();
      if (reply === '') return false;
      if (isDone(reply)) {
        closing = true;
        const rest = unanswered(qs).map((q) => ({ n: q.id, topic: q.topic, text: q.text, default: q.default }));
        answers = rest.map((q) => ({ n: q.n, answer: q.default, source: ('default') }));
        appendFileSync(conversationPath, `\n## Round ${round - 1}\n\n${ENDED}\n${formatBatchLog(rest, answers)}\n`);
        break;
      }
      const r = resolveAnswer(batch, reply);
      if (!r.ok) {
        say(`${r.reason}\n`);
        continue;
      }
      answers = r.answers;
      appendFileSync(conversationPath, `\n## Round ${round - 1}\n\n${formatBatchLog(batch, answers)}\n`);
      break;
    }
    writeQuestions(repoDir, recordAnswers(qs, answers));
    git(repoDir, 'add', '-A', '--', '.', `:!${LOCK_FILE}`);
    git(repoDir, 'commit', '-q', '-m', `hodge ${runId}: answers to round ${round - 1}`);
    return true;
  };

  for (;;) {
    if (!(await askBatch())) return { status: 'paused', rounds: ran, reason: 'no answer given; run `hodge` again to resume' };
    if (ran >= maxRounds) return { status: 'max-rounds', rounds: ran, reason: `stopped after ${maxRounds} rounds; run again to continue` };
    const res = await runInterview({ config, repoDir, runId, adapter, objective: brief, round, closing, inboxDir, identity, note });
    ran++;
    round++;
    if (res.status === 'ok') return { status: 'ok', rounds: ran };
    if (res.status !== 'incomplete') return { status: res.status, rounds: ran, ...(res.reason ? { reason: res.reason } : {}) };
    note = res.reason?.startsWith('invalid ') ? res.reason : '';
    if (unanswered(readQuestions(repoDir)).length === 0) {
      closing = true;
      // gaps are in the next prompt; retry once, stall only when they did not change
      const gaps = res.reason ?? '';
      if (gaps === lastStall) return { status: 'stalled', rounds: ran, reason: `agent left gaps but reported no question to ask: ${gaps}` };
      lastStall = gaps;
    }
  }
}
