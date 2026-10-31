import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Modes named in specs/modes.md; each needs its own file in prompts/ before it can run. */
export const MODES = ['interview', 'plan', 'plan-loop', 'forward', 'reverse', 'brownfield', 'test-hardening', 'clean-room'];

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

/** The `interview` mode's loop prompt is named interview-loop.md (interview-intro.md is a separate, unrelated file). */
const MODE_FILES = { interview: 'interview-loop.md' };

export function loadModePrompt(mode) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode: ${mode}`);
  const file = join(promptsDir, MODE_FILES[mode] ?? `${mode}.md`);
  if (!existsSync(file)) throw new Error(`no prompt written for mode: ${mode}`);
  return readFileSync(file, 'utf8').trimEnd();
}

/** Prompt for the QA cycle (not a mode: it runs between build cycles, never as the loop prompt). */
export function loadQaPrompt() {
  return readFileSync(join(promptsDir, 'qa.md'), 'utf8').trimEnd();
}

/** Static header written at the top of a project's `.hodgepodge/interview.md` the first time it is created.
 * Not trimmed (unlike the other loaders here): it is the store's literal file header, not a section joined
 * with others, and keeps its own trailing blank line before the question list. */
export function loadInterviewIntro() {
  return readFileSync(join(promptsDir, 'interview-intro.md'), 'utf8');
}

// Guidance for one declared spec format (`prompts/formats/<format>.md`).
export function loadFormatSkill(format) {
  const file = join(promptsDir, 'formats', `${format}.md`);
  if (!/^[A-Za-z0-9-]+$/.test(format) || !existsSync(file)) throw new Error(`no skill snippet for format: ${format}`);
  return readFileSync(file, 'utf8').trimEnd();
}
