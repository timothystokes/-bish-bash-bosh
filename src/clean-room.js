import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The only paths that may cross the context firewall into the builder repo. */
const BUNDLE = ['specs', 'tests'];

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Clean-room export: copy only specs/ and tests/ from the source repo into a fresh builder repo
// (one root commit). Nothing else, so the builder never sees the source, plan or run records.
export function exportBundle({ sourceDir, builderDir }) {
  const src = resolve(sourceDir);
  const dest = resolve(builderDir);
  if (src === dest) return { ok: false, reason: 'source and builder repo must differ' };
  for (const d of BUNDLE) {
    const p = join(src, d);
    if (!existsSync(p) || !statSync(p).isDirectory() || readdirSync(p).length === 0) {
      return { ok: false, reason: `source has no ${d}/ to export` };
    }
  }
  if (existsSync(dest) && readdirSync(dest).length > 0) {
    return { ok: false, reason: `builder dir is not empty: ${dest}` };
  }
  mkdirSync(dest, { recursive: true });
  git(dest, 'init', '-q', '-b', 'main');
  for (const d of BUNDLE) cpSync(join(src, d), join(dest, d), { recursive: true });
  git(dest, 'add', '-A');
  git(dest, '-c', 'user.name=hodge', '-c', 'user.email=hodge@localhost', 'commit', '-q', '-m', 'clean-room bundle: specs + tests only');
  return { ok: true, sha: git(dest, 'rev-parse', 'HEAD').trim(), files: git(dest, 'ls-files').split('\n').filter(Boolean) };
}

