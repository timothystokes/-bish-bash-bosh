import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Modes named in specs/modes.md; each prompt lives with the code of the command that uses it. */
const MODE_FILES = {
  'bootstrap': 'bish/prompts/bish-bootstrap.md',
  interview: 'bish/prompts/bish-loop.md',
  reverse: 'bish/prompts/bish-reverse.md',
  'plan-loop': 'bash/prompts/bash-loop.md',
  'build-loop': 'bosh/prompts/bosh-build.md',
  'qa-loop': 'bosh/prompts/bosh-qa.md',
};
export const MODES = Object.keys(MODE_FILES);

export function loadModePrompt(mode) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode: ${mode}`);
  const file = join(srcDir, MODE_FILES[mode]);
  if (!existsSync(file)) throw new Error(`no prompt written for mode: ${mode}`);
  return readFileSync(file, 'utf8').trimEnd();
}

/** `src/bish/prompts/bish-loop-intro.md`'s raw content. The Interview Loop
 * (`src/bish/bish-interview-loop.js`) prefaces it, trimmed, onto the very first agent
 * prompt of a new session only — never on a later round, and never again after a restart that
 * resumes the same persisted session id. Not trimmed here: callers decide that for themselves. */
export function loadInterviewIntro() {
  return readFileSync(join(srcDir, 'bish', 'prompts', 'bish-loop-intro.md'), 'utf8');
}

/** `src/bash/prompts/bash-intro.md`'s raw content, prefaced (trimmed, by the caller) onto the very first agent
 * prompt of a new Plan Loop session only (`src/bash/bash-plan-loop.js`) — mirrors `loadInterviewIntro`
 * above exactly, for the same reason: never on a later item, never again after a restart that resumes
 * the same persisted `bashSession` id. */
export function loadPlanIntro() {
  return readFileSync(join(srcDir, 'bash', 'prompts', 'bash-intro.md'), 'utf8');
}
