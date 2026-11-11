// The bootstrap step: the very first `bish` run hands the project's README.md to the agent once
// (src/bish/prompts/bish-bootstrap.md) to turn it into a baseline `.bish-bash-bosh/specification.md` and the
// first questions in `.bish-bash-bosh/interview.md`, both seeded from their templates beforehand.
import { loadModePrompt } from '../shared/prompts.js';
import { parseInterview, nextQuestion } from './bish-interview-loop.js';

export const README_FILE = 'README.md';

export function buildBootstrapPrompt() {
  return loadModePrompt('bootstrap');
}

// Runs the agent once, then checks it actually did both jobs: the specification differs from its
// template and the interview has at least one unprocessed question. Throws otherwise, so the caller
// can discard the seeded files and the next `bish` run retries this step.
export async function runBootstrap({ adapter, repoDir, readFile, specPath, interviewPath, specTemplate, say = (/** @type {string} */ _s) => {}, log = (/** @type {string} */ _src, /** @type {string} */ _text) => {} }) {
  const prompt = buildBootstrapPrompt();
  log('bish', prompt);
  say('\x1b[90mReading README.md to draft the baseline specification and first questions...\n');
  let reasoning = '';
  await adapter.run({
    prompt,
    cwd: repoDir,
    limits: {},
    onReasoning: (chunk) => {
      reasoning += chunk;
      say(chunk);
    },
  });
  say('\x1b[0m\n');
  if (reasoning) log('agent', reasoning);
  if (readFile(specPath) === specTemplate) throw new Error('the agent left specification.md unchanged from its template');
  if (!nextQuestion(parseInterview(readFile(interviewPath)))) throw new Error('the agent wrote no unprocessed question to interview.md');
}
