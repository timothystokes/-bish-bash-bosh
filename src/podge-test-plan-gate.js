import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Parse `tests/PLAN.md` text into spec path or requirement ID (`R-<spec>-<n>`) -> mapped test paths.
export function parseTestPlan(text) {
  const mapped = new Map();
  for (const line of text.split('\n')) {
    const specs = line.match(/specs\/[\w./-]+\.md|\bR-[\w-]+-\d+\b/g) ?? [];
    const tests = (line.match(/tests\/[\w./-]+/g) ?? []).filter((t) => t !== 'tests/PLAN.md');
    for (const s of specs) mapped.set(s, [...(mapped.get(s) ?? []), ...tests]);
  }
  return mapped;
}

// Test-plan gate: the target needs `tests/PLAN.md` mapping every spec to existing tests,
// and (before the first build iteration) the suite must be red.
// A mapping is any line of PLAN.md naming a `specs/*.md` path and a `tests/*` path.
export function checkTestPlanGate(repoDir, { testCommand, requireRed }) {
  const planPath = join(repoDir, 'tests', 'PLAN.md');
  if (!existsSync(planPath)) return { ok: false, reason: 'tests/PLAN.md is missing' };

  const mapped = parseTestPlan(readFileSync(planPath, 'utf8'));

  const specsDir = join(repoDir, 'specs');
  const specs = existsSync(specsDir) ? readdirSync(specsDir).filter((f) => f.endsWith('.md')) : [];
  const unmapped = specs.map((f) => `specs/${f}`).filter((s) => (mapped.get(s) ?? []).length === 0);
  if (unmapped.length > 0) return { ok: false, reason: `specs with no mapped test in tests/PLAN.md: ${unmapped.join(', ')}` };
  if (mapped.size === 0) return { ok: false, reason: 'tests/PLAN.md maps no specs to tests' };

  const missing = [...new Set([...mapped.values()].flat())].filter((t) => !existsSync(join(repoDir, t)));
  if (missing.length > 0) return { ok: false, reason: `mapped tests do not exist: ${missing.join(', ')}` };

  if (requireRed) {
    const [cmd, ...args] = testCommand;
    const t = spawnSync(cmd, args, { cwd: repoDir, encoding: 'utf8' });
    if (t.status === 0) return { ok: false, reason: 'tests must fail first (red) before build loops start, but the suite is green' };
  }
  return { ok: true };
}
