import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, posix } from 'node:path';

// The loop prompt tells the agent to update plan.md, so it is always in scope.
const ALWAYS_ALLOWED = ['plan.md'];

// Scope gate: every changed file must sit inside an allowed path.
export function checkScopeGate(changedFiles, allowedPaths) {
  const allowed = [...allowedPaths, ...ALWAYS_ALLOWED].map((p) => posix.normalize(p).replace(/\/+$/, ''));
  const outside = changedFiles.filter((f) => {
    const raw = f.replace(/\\/g, '/');
    if (raw.split('/').includes('..')) return true;
    const n = posix.normalize(raw);
    if (n.startsWith('/')) return true;
    return !allowed.some((a) => n === a || n.startsWith(`${a}/`));
  });
  return outside.length === 0
    ? { ok: true }
    : { ok: false, reason: `changes outside allowed paths: ${outside.join(', ')}` };
}

const STUB_MARKERS = [
  { re: /\b(TODO|FIXME|XXX)\b/, label: 'TODO/FIXME marker' },
  { re: /not\s+(yet\s+)?implemented/i, label: '"not implemented"' },
  { re: /\bstub(bed)?\b/i, label: 'stub' },
  { re: /\bplaceholder\b/i, label: 'placeholder' },
];
const EMPTY_BODY = /(\)|=>)\s*\{\s*\}/;

// Anti-stub gate: scan lines the diff adds for stub markers and empty function bodies.
export function checkAntiStubGate(diff) {
  const problems = [];
  let file = '';
  let block = [];
  const flush = () => {
    if (block.length > 0 && EMPTY_BODY.test(block.join('\n'))) problems.push(`${file}: empty function body`);
    block = [];
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      flush();
      file = line.slice(4).replace(/^b\//, '');
    } else if (line.startsWith('+') && !file.endsWith('.md')) {
      const added = line.slice(1);
      block.push(added);
      for (const { re, label } of STUB_MARKERS) {
        if (re.test(added)) problems.push(`${file}: ${label}: ${added.trim()}`);
      }
    } else {
      flush();
    }
  }
  flush();
  return problems.length === 0 ? { ok: true } : { ok: false, reason: problems.join('; ') };
}

// Type gate: run the type-check command when the repo has a tsconfig.json.
export function checkTypeGate(repoDir, command = ['npx', '--no-install', 'tsc', '-p', 'tsconfig.json', '--noEmit']) {
  if (!existsSync(join(repoDir, 'tsconfig.json'))) return { ok: true, detail: 'skipped: no tsconfig.json' };
  const [cmd, ...args] = command;
  const r = spawnSync(cmd, args, { cwd: repoDir, encoding: 'utf8' });
  if (r.status === 0) return { ok: true };
  return { ok: false, reason: `type check failed: ${`${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)}` };
}
