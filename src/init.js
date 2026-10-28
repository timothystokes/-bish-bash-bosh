import { mkdirSync, readdirSync, existsSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { validateConfig } from './config.js';
import { CONFIG_FILE } from './project-config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const templates = join(root, 'templates');

// Sensible defaults for a live agent: one conversation round plus several steps (same figures the
// former sandbox scaffolding used), and the paths an objective-kit build is allowed to touch.
const DEFAULT_BUDGETS = { maxWallClockSeconds: 7200, maxIterations: 20 };
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

// `hodgepodge init`: writes <dir>/hodgepodge.yml (default dir: cwd) for the build role (and optionally
// qa) the owner chose, with default budgets and allowedPaths. The same adapter/model also seed the
// `interview` and `reverse` roles `hodge` needs, so `hodge` works right after init (hand-edit
// hodgepodge.yml to use a different adapter/model for those). Refuses if a config already exists.
// There is no sandbox to scaffold: no target repo, no runtime copy, no launcher scripts.
export function initProject({ dir, build, qa = undefined }) {
  if (!build?.adapter || !build?.model) return { ok: false, reason: 'build adapter and model are required' };
  const projectDir = resolve(dir ?? '.');
  const configPath = join(projectDir, CONFIG_FILE);
  if (existsSync(configPath)) return { ok: false, reason: `${configPath} already exists` };
  const roles = { build, interview: { ...build }, reverse: { ...build } };
  if (qa) roles.qa = qa;
  const cfg = {
    roles,
    budgets: { ...DEFAULT_BUDGETS },
    allowedPaths: [...DEFAULT_ALLOWED_PATHS],
    requireTestPlan: true,
  };
  const valid = validateConfig(cfg);
  if (!valid.ok) return { ok: false, reason: `invalid config: ${valid.errors.join('; ')}` };
  writeFileSync(configPath, stringifyYaml(cfg));
  return { ok: true, dir: projectDir, config: configPath };
}

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyTree(join(from, e.name), join(to, e.name));
    else copyFileSync(join(from, e.name), join(to, e.name));
  }
}

// Add the objective kit to an existing project: nothing already there (plan.md, package.json, specs) is touched.
export function addObjectiveKit(repo) {
  copyTree(join(templates, 'objective'), join(repo, 'objective'));
  rmSync(join(repo, 'objective', 'plan.md'));
}
