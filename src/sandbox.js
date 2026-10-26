import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateConfig } from './config.js';

export const CONFIG_FILE = 'hodge.json';

/**
 * Load a sandbox created by `hodgepodge init`: `<dir>/hodge.json` holds everything else
 * (target repo, roles, budgets, and where hodgepodge itself lives). A relative `targetRepo` is relative to `<dir>`.
 * @param {string} dir
 * @returns {{ok: true, dir: string, configPath: string, config: any, repo: string} | {ok: false, error: string}}
 */
export function loadSandbox(dir) {
  const root = resolve(dir);
  const configPath = join(root, CONFIG_FILE);
  /** @type {any} */
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (e) {
    return { ok: false, error: `cannot read config '${configPath}' (run from a sandbox made by \`hodgepodge init\`, or pass --dir): ${/** @type {Error} */ (e).message}` };
  }
  const v = validateConfig(config);
  if (!v.ok) return { ok: false, error: `invalid config: ${v.errors.join('; ')}` };
  const repo = resolve(root, config.targetRepo);
  return { ok: true, dir: root, configPath, config: { ...config, targetRepo: repo }, repo };
}
