import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { validateConfig } from './config.js';

export const CONFIG_FILE = '.hodgepodge/config.yml';

// Load the project config: `<dir>/.hodgepodge/config.yml` (default dir: the current working directory) holds
// roles, allowedPaths and the rest (`src/config.schema.json`). There is no separate sandbox or target repo:
// hodgepodge always operates on this project directory directly.
export function loadProjectConfig(dir = '.') {
  const root = resolve(dir);
  const configPath = join(root, CONFIG_FILE);
  let raw;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (e) {
    return { ok: false, error: `cannot read config '${configPath}' (run \`hodgepodge init\` first): ${e.message}` };
  }
  let config;
  try {
    config = parseYaml(raw);
  } catch (e) {
    return { ok: false, error: `invalid YAML in '${configPath}': ${e.message}` };
  }
  const v = validateConfig(config);
  if (!v.ok) return { ok: false, error: `invalid config: ${v.errors.join('; ')}` };
  return { ok: true, dir: root, configPath, config, repo: root };
}
