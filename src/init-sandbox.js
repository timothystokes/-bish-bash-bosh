/**
 * Sandbox scaffolding: a fresh target repo (git, seeded) plus a config outside it.
 * The target never lives inside hodgepodge (repo gate).
 */
import { mkdirSync, readdirSync, existsSync, writeFileSync, copyFileSync, rmSync, chmodSync, cpSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRepoGate } from './repo-gate.js';
import { validateConfig } from './config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const templates = join(root, 'templates');
const SEEDS = ['toy', 'empty', 'objective'];
const LAUNCHERS = ['hodgepodge', 'hodge', 'podge'];
const RUNTIME_DIR = '.hodgepodge';
const RUNTIME_FILES = ['bin', 'src', 'prompts', 'templates', 'package.json', 'package-lock.json'];
const IGNORE = 'node_modules/\nruns/\n';

/**
 * @typedef {{dir: string, adapter: string, model: string, seed?: string}} InitOptions
 * @param {InitOptions} opts dir is the sandbox root: `<dir>/target` (repo), `<dir>/.hodgepodge` (a copy of the runtime: code, prompts, templates, production dependencies), `<dir>/hodge.json` (config; `targetRepo` and `hodgepodge` are relative to dir) and `<dir>/hodgepodge`, `<dir>/hodge`, `<dir>/podge` (launchers)
 * @returns {{ok: true, dir: string, repo: string, config: string, hodgepodge: string} | {ok: false, reason: string}}
 */
export function initSandbox(opts) {
  const seed = opts.seed ?? 'toy';
  if (!SEEDS.includes(seed)) return { ok: false, reason: `unknown seed '${seed}' (one of ${SEEDS.join(', ')})` };
  if (!opts.dir) return { ok: false, reason: 'dir is required' };
  const dir = resolve(opts.dir);
  const repo = join(dir, 'target');
  const config = join(dir, 'hodge.json');
  const cfg = {
    targetRepo: 'target',
    hodgepodge: RUNTIME_DIR,
    roles: {
      build: { adapter: opts.adapter, model: opts.model },
      interview: { adapter: opts.adapter, model: opts.model },
      reverse: { adapter: opts.adapter, model: opts.model },
    },
    budgets: { maxTokens: 5000000, maxCostUsd: 20, maxWallClockSeconds: 7200, maxIterations: 20 },
    allowedPaths: seed === 'objective' ? ['src/', 'bin/', 'lib/', 'package.json'] : ['src/'],
    requireTestPlan: seed !== 'empty',
  };
  const valid = validateConfig(cfg);
  if (!valid.ok) return { ok: false, reason: `invalid config: ${valid.errors.join('; ')}` };
  const gate = checkRepoGate(dir);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  if (existsSync(dir) && readdirSync(dir).length > 0) return { ok: false, reason: `${dir} exists and is not empty` };

  try {
    mkdirSync(repo, { recursive: true });
    if (seed === 'toy') copyTree(join(templates, 'toy'), repo);
    else if (seed === 'objective') seedObjective(repo);
    else writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'target', private: true, type: 'module' }, null, 2) + '\n');
    writeFileSync(join(repo, '.gitignore'), IGNORE);
    copyRuntime(join(dir, RUNTIME_DIR));
    writeFileSync(config, JSON.stringify(cfg, null, 2) + '\n');
    // So the owner can `cd <dir>` and run `./hodge`, `./podge`, `./podge step`, ... without any path flags.
    for (const name of LAUNCHERS) {
      const path = join(dir, name);
      writeFileSync(path, `#!/bin/sh\nexec node "$(dirname "$0")/${RUNTIME_DIR}/bin/${name}" "$@"\n`);
      chmodSync(path, 0o755);
    }
    const git = (/** @type {string[]} */ ...a) =>
      execFileSync('git', ['-C', repo, '-c', 'user.name=hodge-init', '-c', 'user.email=hodge-init@localhost', ...a], { stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-qm', `init: ${seed} seed`);
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    return { ok: false, reason: `init failed: ${/** @type {Error} */ (e).message}` };
  }
  return { ok: true, dir, repo, config, hodgepodge: join(dir, RUNTIME_DIR) };
}

/**
 * Copy what the tool needs at runtime so the sandbox never reads the hodgepodge checkout:
 * code, prompts, templates and the production dependency closure from package-lock.json.
 * @param {string} to
 */
function copyRuntime(to) {
  mkdirSync(to, { recursive: true });
  for (const f of RUNTIME_FILES) cpSync(join(root, f), join(to, f), { recursive: true });
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  for (const [path, info] of Object.entries(/** @type {Record<string, {dev?: boolean}>} */ (lock.packages))) {
    if (!path.startsWith('node_modules/') || info.dev) continue;
    if (existsSync(join(root, path))) cpSync(join(root, path), join(to, path), { recursive: true });
  }
}

/**
 * @param {string} from
 * @param {string} to
 */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyTree(join(from, e.name), join(to, e.name));
    else copyFileSync(join(from, e.name), join(to, e.name));
  }
}

/**
 * Add the objective kit to an existing target: nothing already there (plan.md, package.json, specs) is touched.
 * @param {string} repo
 */
export function addObjectiveKit(repo) {
  copyTree(join(templates, 'objective'), join(repo, 'objective'));
  rmSync(join(repo, 'objective', 'plan.md'));
}

/**
 * The objective kit (phases, interview protocol, readiness signals, brief, open questions) goes to
 * `objective/`; the starter plan.md goes to the repo root. Nothing here is specific to a solution:
 * the objective itself is gathered later by `hodge`.
 * @param {string} repo
 */
function seedObjective(repo) {
  const kit = join(templates, 'objective');
  copyTree(kit, join(repo, 'objective'));
  rmSync(join(repo, 'objective', 'plan.md'));
  copyFileSync(join(kit, 'plan.md'), join(repo, 'plan.md'));
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'target', private: true, type: 'module', scripts: { test: 'node --test tests/*.test.js' } }, null, 2) + '\n');
}
