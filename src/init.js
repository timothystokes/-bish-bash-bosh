import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { validateConfig } from './config.js';
import { CONFIG_FILE } from './project-config.js';

const DEFAULT_ALLOWED_PATHS = ['src/', 'bin/', 'lib/', 'package.json'];

// Suggested picks shown by `hodgepodge init`'s interactive prompt (src/hodgepodge.js). This is a
// convenience catalog only, not enforced anywhere: any adapter/model string still works (see
// src/adapters/index.js's registry and specs/adapters.md's documented exception for this list).
// It goes stale as vendors release models; update it by hand when that happens.
export const ADAPTER_CHOICES = ['copilot', 'claude-code', 'codex', 'openai-http'];
export const MODEL_CHOICES = {
  copilot: ['gpt-5', 'claude-sonnet-4.5', 'claude-opus-4.1', 'auto'],
  'claude-code': ['claude-opus-4-1-20250805', 'claude-sonnet-4-5-20250929'],
  codex: ['gpt-5-codex', 'gpt-5'],
  // openai-http hits an arbitrary /chat/completions endpoint: no catalog, type the model directly.
};

// The four roles hodge and podge use, hardcoded (not a user choice): hodge needs `interview`
// (and `reverse` for `hodge --reverse`), podge needs `build` (and `qa` when a plan calls for it).
// `hodgepodge init` asks for a single adapter/model and applies it to all four; hand-edit
// .hodgepodge/config.yml afterward to use a different adapter/model for a specific role.
export const ROLE_NAMES = ['interview', 'reverse', 'build', 'qa'];

// `hodgepodge init`: writes <dir>/.hodgepodge/config.yml (default dir: cwd) with every role (`interview`,
// `reverse`, `build`, `qa`) the owner picked, plus default allowedPaths. Refuses if a
// config already exists. There is no sandbox to scaffold: no target repo, no runtime copy, no
// launcher scripts.
export function initProject({ dir, roles }) {
  for (const name of ROLE_NAMES) {
    if (!roles?.[name]?.adapter || !roles[name]?.model) return { ok: false, reason: `${name} adapter and model are required` };
  }
  const projectDir = resolve(dir ?? '.');
  const configPath = join(projectDir, CONFIG_FILE);
  if (existsSync(configPath)) return { ok: false, reason: `${configPath} already exists` };
  const cfg = {
    roles: { interview: roles.interview, reverse: roles.reverse, build: roles.build, qa: roles.qa },
    allowedPaths: [...DEFAULT_ALLOWED_PATHS],
    requireTestPlan: true,
  };
  const valid = validateConfig(cfg);
  if (!valid.ok) return { ok: false, reason: `invalid config: ${valid.errors.join('; ')}` };
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, stringifyYaml(cfg));
  return { ok: true, dir: projectDir, config: configPath };
}
