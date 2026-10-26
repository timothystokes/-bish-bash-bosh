/**
 * Sandbox scaffolding: a fresh target repo (git, seeded) plus a config outside it.
 * The target never lives inside hodgepodge (repo gate).
 */
import { mkdirSync, readdirSync, existsSync, writeFileSync, copyFileSync, rmSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRepoGate } from './repo-gate.js';
import { validateConfig } from './config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const templates = join(root, 'templates');
const SEEDS = ['toy', 'empty', 'objective'];
const LAUNCHERS = ['hodgepodge', 'hodge', 'podge'];
const IGNORE = 'node_modules/\nruns/\n';

/**
 * @typedef {{dir: string, adapter: string, model: string, seed?: string}} InitOptions
 * @param {InitOptions} opts dir is the sandbox root: `<dir>/target` (repo), `<dir>/hodge.json` (config; `targetRepo` is relative to dir, `hodgepodge` points back at this tool) and `<dir>/hodgepodge`, `<dir>/hodge`, `<dir>/podge` (launchers)
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
    hodgepodge: root,
    roles: {
      build: { adapter: opts.adapter, model: opts.model },
      interview: { adapter: opts.adapter, model: opts.model },
      reverse: { adapter: opts.adapter, model: opts.model },
    },
    budgets: { maxTokens: 200000, maxCostUsd: 2, maxWallClockSeconds: 600, maxIterations: 3 },
    allowedPaths: ['src/'],
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
    writeFileSync(config, JSON.stringify(cfg, null, 2) + '\n');
    // So the owner can `cd <dir>` and run `./hodge`, `./podge`, `./hodgepodge step`, ... without any path flags.
    for (const name of LAUNCHERS) {
      const path = join(dir, name);
      writeFileSync(path, `#!/bin/sh\nexec node ${JSON.stringify(join(root, 'bin', name))} "$@"\n`);
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
  return { ok: true, dir, repo, config, hodgepodge: root };
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
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'target', private: true, type: 'module' }, null, 2) + '\n');
}
