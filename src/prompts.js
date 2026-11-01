import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Modes named in specs/modes.md; each needs its own file in prompts/ before it can run. */
export const MODES = ['interview', 'plan-loop', 'build-loop', 'reverse'];

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

/** The `interview` mode's loop prompt is named interview-loop.md; `interview-intro.md` is loaded
 * separately (see `loadInterviewIntro` below), not through this mode-file map. */
const MODE_FILES = { interview: 'interview-loop.md' };

export function loadModePrompt(mode) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode: ${mode}`);
  const file = join(promptsDir, MODE_FILES[mode] ?? `${mode}.md`);
  if (!existsSync(file)) throw new Error(`no prompt written for mode: ${mode}`);
  return readFileSync(file, 'utf8').trimEnd();
}

/** `prompts/interview-intro.md`'s raw content. Two unrelated consumers: the legacy, CLI-unreachable
 * `hodge-questions.js` store uses it untrimmed as `STORE_HEADER`, its literal file header; the live
 * Interview Loop (`src/hodge-interview-loop.js`) prefaces it, trimmed, onto the very first agent
 * prompt of a new session only — never on a later round, and never again after a restart that
 * resumes the same persisted session id. Not trimmed here: callers decide that for themselves. */
export function loadInterviewIntro() {
  return readFileSync(join(promptsDir, 'interview-intro.md'), 'utf8');
}

/** `prompts/plan-intro.md`'s raw content, prefaced (trimmed, by the caller) onto the very first agent
 * prompt of a new Plan Loop session only (`src/gepo-plan-loop.js`) — mirrors `loadInterviewIntro`
 * above exactly, for the same reason: never on a later item, never again after a restart that resumes
 * the same persisted `gepoSession` id. */
export function loadPlanIntro() {
  return readFileSync(join(promptsDir, 'plan-intro.md'), 'utf8');
}

/** `prompts/build-intro.md`'s raw content, prefaced (trimmed, by the caller) onto the very first agent
 * prompt of a new Build Loop session only (`src/podge-build-loop.js`) — mirrors `loadPlanIntro` above
 * exactly, for the same reason: never on a later item, never again after a restart that resumes the
 * same persisted `podgeSession` id. */
export function loadBuildIntro() {
  return readFileSync(join(promptsDir, 'build-intro.md'), 'utf8');
}

// Guidance for one declared spec format (`prompts/formats/<format>.md`).
export function loadFormatSkill(format) {
  const file = join(promptsDir, 'formats', `${format}.md`);
  if (!/^[A-Za-z0-9-]+$/.test(format) || !existsSync(file)) throw new Error(`no skill snippet for format: ${format}`);
  return readFileSync(file, 'utf8').trimEnd();
}
