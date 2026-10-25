import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** @typedef {{repo: string, config: string}} Settings */

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} where `hodge init` persists the active repo/config
 */
export function defaultSettingsFile(env = process.env) {
  return env.HODGE_SETTINGS || join(homedir(), '.hodge', 'settings.json');
}

/**
 * @param {string} file
 * @returns {Settings | null} null when missing or malformed (callers fall back to explicit flags)
 */
export function loadSettings(file) {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    return typeof s?.repo === 'string' && typeof s?.config === 'string' ? { repo: s.repo, config: s.config } : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} file
 * @param {Settings} settings
 */
export function saveSettings(file, settings) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ repo: settings.repo, config: settings.config }, null, 2)}\n`);
}
