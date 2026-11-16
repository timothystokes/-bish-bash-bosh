// The bootstrap step: the very first `bish` run hands the project's README.md to the agent once
// (src/bish/prompts/bish-analyst-init.js) to turn it into a baseline `.bish-bash-bosh/specification.md` and the
// first questions in `.bish-bash-bosh/interview.md`, both seeded from their templates beforehand.
import analystInitPrompt from './prompts/bish-analyst-init.js';
import { parseInterview, nextQuestion } from './bish-analyst-loop.js';

export const README_FILE = 'README.md';

export function buildBootstrapPrompt(settings) {
  return analystInitPrompt(settings);
}

// Runs the agent once, then checks it actually did both jobs: the specification differs from its
// template and the interview has at least one unprocessed question. Throws otherwise, so the caller
// can discard the seeded files and the next `bish` run retries this step.
export async function runBootstrap({ adapter, repoDir, readFile, specPath, interviewPath, specTemplate, interviewTemplate, settings, say = (/** @type {string} */ _s) => {}, log = (/** @type {string} */ _src, /** @type {string} */ _text) => {} }) {
  const prompt = buildBootstrapPrompt(settings);
  log('bish/analyst prompt', prompt);
  say('\x1b[90mReading README.md to draft the baseline specification and first questions...\n');
  let reasoning = '';
  const result = await adapter.run({
    prompt,
    cwd: repoDir,
    limits: {},
    onReasoning: (chunk) => {
      reasoning += chunk;
      say(chunk);
    },
  });
  say('\x1b[0m\n');
  const transcript = result?.transcript ?? '';
  if (reasoning) log('bish/analyst reasoning', reasoning);
  if (transcript) log('bish/analyst response', transcript);
  // Keep the final response distinct from streamed reasoning so errors explain what the agent actually returned.
  const detail = () => {
    const status = result?.exitStatus ? ` (agent exit status ${result.exitStatus})` : '';
    const output = transcript.trim().slice(-1500);
    const thoughts = reasoning.trim().slice(-1500);
    const parts = [];
    if (output) parts.push(`Last agent output:\n${output}`);
    if (thoughts) parts.push(`Agent reasoning:\n${thoughts}`);
    return `${status}${parts.length ? `\n${parts.join('\n')}` : '\nThe agent produced no output.'}`;
  };
  if (readFile(specPath) === specTemplate) throw new Error(`the agent left specification.md unchanged from its template${detail()}`);
  if (readFile(interviewPath) === interviewTemplate) throw new Error(`the agent left interview.md unchanged from its template${detail()}`);
  if (!nextQuestion(parseInterview(readFile(interviewPath)))) throw new Error(`the agent wrote no unprocessed question to interview.md${detail()}`);
}
