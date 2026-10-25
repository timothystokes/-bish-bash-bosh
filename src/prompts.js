import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Modes named in specs/modes.md; each needs its own file in prompts/ before it can run. */
export const MODES = ['interview', 'forward', 'reverse', 'brownfield', 'test-hardening', 'clean-room'];

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

/**
 * @param {string} mode
 * @returns {string}
 */
export function loadModePrompt(mode) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode: ${mode}`);
  const file = join(promptsDir, `${mode}.md`);
  if (!existsSync(file)) throw new Error(`no prompt written for mode: ${mode}`);
  return readFileSync(file, 'utf8').trimEnd();
}
