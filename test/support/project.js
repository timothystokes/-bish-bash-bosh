import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';

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

// Writes `<dir>/.bish-bash-bosh/config.yml`: replaces the project config a sandbox's bish.json used to hold.
export function writeProjectConfig(dir, config) {
  mkdirSync(join(dir, '.bish-bash-bosh'), { recursive: true });
  writeFileSync(join(dir, '.bish-bash-bosh', 'config.yml'), stringifyYaml(config));
  return dir;
}

// Writes and commits .bish-bash-bosh/config.yml: for fixtures where the repo gate's "working tree is clean" check
// must pass (the config lives inside the project now, not in a separate sandbox dir).
export function commitProjectConfig(dir, config) {
  writeProjectConfig(dir, config);
  git(dir, 'add', join('.bish-bash-bosh', 'config.yml'));
  git(dir, 'commit', '-q', '-m', 'bish-bash-bosh: config');
  return dir;
}

// Build a project fixture: a fresh git repo plus a package.json with a test script. Replaces what
// `initSandbox`'s 'objective' seed used to do, now that there is no kit left to scaffold.
export function seedObjectiveProject(dir) {
  initGitRepo(dir);
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
