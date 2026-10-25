import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Build the sandbox directory the CLI now expects: a dir holding hodge.json whose targetRepo is the repo.
 * @param {string | object} config a config object, or the path of a config file
 * @param {string} [repo] the target repo (an absolute path); defaults to the config's own targetRepo
 * @returns {string} the sandbox dir to pass as --dir
 */
export function sandboxOf(config, repo) {
  const cfg = typeof config === 'string' ? JSON.parse(readFileSync(config, 'utf8')) : config;
  const dir = mkdtempSync(join(tmpdir(), 'hodge-sb-'));
  writeFileSync(join(dir, 'hodge.json'), JSON.stringify({ ...cfg, ...(repo ? { targetRepo: repo } : {}) }));
  return dir;
}
