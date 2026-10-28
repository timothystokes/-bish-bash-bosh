import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const templates = join(root, 'templates');

export function freshDir(prefix = 'hp-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

export function initGitRepo(dir) {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  return dir;
}

// Writes `<dir>/hodgepodge.yml`: replaces the project config a sandbox's hodge.json used to hold.
export function writeProjectConfig(dir, config) {
  writeFileSync(join(dir, 'hodgepodge.yml'), stringifyYaml(config));
  return dir;
}

// Writes and commits hodgepodge.yml: for fixtures where the repo gate's "working tree is clean" check
// must pass (the config lives inside the project now, not in a separate sandbox dir).
export function commitProjectConfig(dir, config) {
  writeProjectConfig(dir, config);
  git(dir, 'add', 'hodgepodge.yml');
  git(dir, 'commit', '-q', '-m', 'hodgepodge: config');
  return dir;
}

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyTree(join(from, e.name), join(to, e.name));
    else copyFileSync(join(from, e.name), join(to, e.name));
  }
}

// Build a project fixture seeded with the objective kit: a fresh git repo, objective/ kit (minus
// plan.md), a starter plan.md, and a package.json with a test script. Replaces what `initSandbox`'s
// 'objective' seed used to do, now that init doesn't scaffold anything.
export function seedObjectiveProject(dir) {
  initGitRepo(dir);
  const kit = join(templates, 'objective');
  copyTree(kit, join(dir, 'objective'));
  rmSync(join(dir, 'objective', 'plan.md'));
  copyFileSync(join(kit, 'plan.md'), join(dir, 'plan.md'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'target', private: true, type: 'module', scripts: { test: 'node --test tests/*.test.js' } }, null, 2) + '\n');
  return dir;
}

// Run `fn` with the process cwd set to `dir`, restoring it afterwards: the CLI (main()) always
// operates on cwd now, so tests exercising it must chdir instead of passing a sandbox --dir.
export async function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}
