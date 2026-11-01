// Parse `tests/PLAN.md` text into spec path or requirement ID (`R-<spec>-<n>`) -> mapped test paths.
// Used by spec-lint.js (ready/spec-lint check every spec has a mapped test); the old build loop's own
// gate that used this (`checkTestPlanGate`, requiring tests/PLAN.md + a red suite before building) was
// removed along with it.
export function parseTestPlan(text) {
  const mapped = new Map();
  for (const line of text.split('\n')) {
    const specs = line.match(/specs\/[\w./-]+\.md|\bR-[\w-]+-\d+\b/g) ?? [];
    const tests = (line.match(/tests\/[\w./-]+/g) ?? []).filter((t) => t !== 'tests/PLAN.md');
    for (const s of specs) mapped.set(s, [...(mapped.get(s) ?? []), ...tests]);
  }
  return mapped;
}
