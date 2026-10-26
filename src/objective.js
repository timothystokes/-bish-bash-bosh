import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasObjectiveKit } from './readiness.js';
import { runInterview } from './interview.js';

/**
 * @typedef {{
 *   status: 'ok' | 'paused' | 'stalled' | 'max-rounds' | 'failed' | 'gated' | 'over-budget',
 *   rounds: number,
 *   reason?: string,
 * }} ObjectiveResult
 */

const PLACEHOLDER = /^Not yet written/m;
const ENDED = 'Ended the interview: the owner said done.';
const isDone = (/** @type {string} */ a) => /^(done|finished)$/i.test(a);

/**
 * @param {string} dir
 * @param {string[]} args
 */
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

/**
 * Requirements gathering: ask for a description of the objective, then alternate agent rounds
 * (which update specs and write one next question) with the owner's answers, broad first and fine-grained
 * later, until `hodgepodge ready` passes. Everything lives in the target repo, so a paused conversation resumes.
 * @param {{
 *   config: unknown,
 *   repoDir: string,
 *   runId: string,
 *   adapter: import('./adapter.js').Adapter,
 *   ask: (prompt: string) => Promise<string | null>,
 *   say: (text: string) => void,
 *   maxRounds?: number,
 *   identity?: import('./repo-gate.js').HarnessIdentity,
 * }} opts
 * @returns {Promise<ObjectiveResult>}
 */
export async function runObjective({ config, repoDir, runId, adapter, ask, say, maxRounds = 30, identity }) {
  /** @param {string} reason @returns {ObjectiveResult} */
  const gated = (reason) => ({ status: 'gated', rounds: 0, reason });
  if (!hasObjectiveKit(repoDir)) return gated('no objective kit in the target (create the sandbox with `hodgepodge init --seed objective`)');
  if (git(repoDir, 'status', '--porcelain').trim() !== '') return gated('working tree is not clean');

  const briefPath = join(repoDir, 'objective', 'BRIEF.md');
  let brief = existsSync(briefPath) ? readFileSync(briefPath, 'utf8') : '';
  if (brief.trim() === '' || PLACEHOLDER.test(brief)) {
    const description = ((await ask('Describe the objective in a sentence or two: what should exist when this is done, and why?\n> ')) ?? '').trim();
    if (description === '') return gated('no objective description given');
    brief = `# Objective brief\n\n${description}\n`;
    writeFileSync(briefPath, brief);
    git(repoDir, 'add', '-A');
    git(repoDir, 'commit', '-q', '-m', 'hodge: brief');
  }

  const runDir = join(repoDir, 'runs', runId);
  let round = (existsSync(runDir) ? readdirSync(runDir).filter((d) => /^interview(-\d+)?$/.test(d)).length : 0) + 1;
  const questionPath = join(repoDir, 'objective', 'QUESTION.md');
  let ran = 0;
  let lastStall = '';
  const conversationPath = join(repoDir, 'objective', 'CONVERSATION.md');
  // Once the owner ends the interview (or the agent has no more questions), rounds check readiness and close the gaps.
  let closing = existsSync(conversationPath) && readFileSync(conversationPath, 'utf8').includes(ENDED);

  /** @returns {Promise<boolean>} false when the owner stopped answering */
  const answerPending = async () => {
    if (!existsSync(questionPath)) return true;
    const question = readFileSync(questionPath, 'utf8').trim();
    const proposed = /^Default:[ \t]*(.+)$/m.exec(question)?.[1]?.trim();
    say(`\n${question}\n(${proposed ? 'type y to accept the default, ' : ''}type done to end the interview)\n`);
    let answer = ((await ask('> ')) ?? '').trim();
    if (answer === '') return false;
    if (isDone(answer)) {
      closing = true;
      answer = ENDED;
    } else if (proposed && /^(y|yes)$/i.test(answer)) answer = `Accepted the proposed default: ${proposed}`;
    appendFileSync(conversationPath, `\n## Round ${round - 1}\n\n**Question:** ${question}\n\n**Answer:** ${answer}\n`);
    rmSync(questionPath);
    git(repoDir, 'add', '-A');
    git(repoDir, 'commit', '-q', '-m', `hodge ${runId}: answer to round ${round - 1}`);
    return true;
  };

  for (;;) {
    if (!(await answerPending())) return { status: 'paused', rounds: ran, reason: 'no answer given; run `hodge` again to resume' };
    if (ran >= maxRounds) return { status: 'max-rounds', rounds: ran, reason: `stopped after ${maxRounds} rounds; run again to continue` };
    const res = await runInterview({ config, repoDir, runId, adapter, objective: brief, round, closing, identity });
    ran++;
    round++;
    if (res.status === 'ok') return { status: 'ok', rounds: ran };
    if (res.status !== 'incomplete') return { status: res.status, rounds: ran, ...(res.reason ? { reason: res.reason } : {}) };
    if (!existsSync(questionPath)) {
      closing = true;
      // gaps are in the next prompt; retry once, stall only when they did not change
      const gaps = res.reason ?? '';
      if (gaps === lastStall) return { status: 'stalled', rounds: ran, reason: `agent left gaps but asked no question (objective/QUESTION.md): ${gaps}` };
      lastStall = gaps;
    }
  }
}
