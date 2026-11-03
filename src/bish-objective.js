import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInterview } from './bish-interview.js';
import { BATCH_HINT, nextBatch, readQuestions, recordAnswers, renderBatch, resolveAnswer, unanswered, writeQuestions } from './bish-questions.js';
import { LOCK_FILE } from './run-lock.js';

const isDone = (a) => /^(done|finished)$/i.test(a);

// Q1 is the objective description, bootstrapped once and never re-asked: it is already "specified" (nothing to
// derive a spec from) but stays visible to the agent every round as persistent context (see `objectiveOf`).
const objectiveOf = (qs) => qs.find((q) => q.id === 1)?.answer ?? '';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

// Requirements gathering: ask for a description of the objective, then alternate agent rounds
// (which update specs and write one next question) with the owner's answers, broad first and fine-grained
// later, until `bish-bash-bosh ready` passes. Everything lives in the target repo, so a paused conversation resumes.
export async function runObjective({ config, repoDir, runId, adapter, ask, say, maxRounds = 30, inboxDir = undefined, identity = undefined }) {
  const gated = (reason) => ({ status: 'gated', rounds: 0, reason });
  // `.bish-bash-bosh/lock` is harness-internal; exclude it from the
  // dirty-working-tree check since it is never committed.
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
    git(repoDir, 'commit', '-q', '-m', 'bish: objective');
  }

  const runDir = join(repoDir, '.bish-bash-bosh', 'runs', runId);
  let round = (existsSync(runDir) ? readdirSync(runDir).filter((d) => /^interview(-\d+)?$/.test(d)).length : 0) + 1;
  let ran = 0;
  let lastStall = '';
  let note = '';
  // Closing only ever turns on, never off, and controls whether the prompt shows readiness gaps; it is not
  // persisted across a paused/resumed session, so a resumed conversation starts assuming it is not yet closing
  // (it flips back on again within a round or two, as soon as no question is left to ask).
  let closing = false;

  const askBatch = async () => {
    const qs = readQuestions(repoDir);
    const batch = nextBatch(qs);
    if (batch.length === 0) return true;
    say(`\n${renderBatch(batch)}\n(${BATCH_HINT})\n`);
    // The owner answers one line at a time: each line overrides one or more defaults, kept here until "ok"
    // (or "done") finalises the batch with any un-overridden question falling back to its default.
    const overrides = new Map();
    let answers;
    for (;;) {
      const reply = (await ask('> ') ?? '').trim();
      if (reply === '') return false;
      if (isDone(reply)) {
        closing = true;
        answers = unanswered(qs).map((q) => ({ n: q.id, answer: overrides.get(q.id) ?? q.default, source: overrides.has(q.id) ? 'owner' : 'default' }));
        break;
      }
      if (/^ok$/i.test(reply)) {
        answers = batch.map((q) => ({ n: q.n, answer: overrides.get(q.n) ?? q.default, source: overrides.has(q.n) ? 'owner' : 'default' }));
        break;
      }
      const r = resolveAnswer(batch, reply);
      if (!r.ok) {
        say(`${r.reason}\n`);
        continue;
      }
      for (const o of r.overrides) overrides.set(o.n, o.answer);
    }
    writeQuestions(repoDir, recordAnswers(qs, answers));
    git(repoDir, 'add', '-A', '--', '.', `:!${LOCK_FILE}`);
    git(repoDir, 'commit', '-q', '-m', `bish ${runId}: answers to round ${round - 1}`);
    return true;
  };

  for (;;) {
    if (!(await askBatch())) return { status: 'paused', rounds: ran, reason: 'no answer given; run `bish` again to resume' };
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
