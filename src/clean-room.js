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

// Firewall gate for clean-room mode: the builder repo must hold a spec bundle, its root commit may
// contain only specs/ and tests/, and it must not point at the source repo.
export function checkCleanRoomGate(repoDir, opts = {}) {
  const fail = (reason) => ({ ok: false, reason: `clean-room firewall: ${reason}` });
  let roots;
  try {
    roots = git(repoDir, 'rev-list', '--max-parents=0', 'HEAD').split('\n').filter(Boolean);
  } catch {
    return fail('builder repo has no commits; run `hodgepodge clean-room` to export the bundle');
  }
  const leaked = new Set();
  for (const root of roots) {
    for (const f of git(repoDir, 'ls-tree', '-r', '--name-only', root).split('\n').filter(Boolean)) {
      if (!BUNDLE.some((d) => f.startsWith(`${d}/`))) leaked.add(f);
    }
  }
  if (leaked.size > 0) return fail(`root commit holds files outside specs/ and tests/: ${[...leaked].join(', ')}`);
  const specs = join(repoDir, 'specs');
  if (!existsSync(specs) || !readdirSync(specs).some((f) => f.endsWith('.md'))) return fail('builder repo has no specs/*.md');
  if (!existsSync(join(repoDir, 'tests'))) return fail('builder repo has no tests/');
  const forbidden = new Set(opts.sourceRemotes ?? []);
  if (forbidden.size > 0) {
    const urls = git(repoDir, 'remote', '-v').split('\n').map((l) => l.split(/\s+/)[1]).filter(Boolean);
    const hit = urls.find((u) => forbidden.has(u));
    if (hit) return fail(`builder repo has the source as a remote: ${hit}`);
  }
  return { ok: true, detail: 'bundle is specs + tests only' };
}
