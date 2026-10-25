# Spec: Gates (back-pressure, harness-enforced)
- Repo gate: refuse if target repo is hodgepodge.
- Test-plan gate: each objective needs `tests/PLAN.md` mapping specs to tests; tests must exist and **fail first** before build loops start. Agent-written tests alone do not satisfy the gate.
- Type gate: `tsc --checkJs` passes.
- Anti-stub gate: reject TODO/stub/"not implemented"/empty bodies in the diff.
- Scope gate: changes confined to the objective's allowed paths.
- Budget gate (`src/budget-gate.js`): tokens, cost, wall-clock and iteration caps per run, summed from run records (`usage.json`, incl. `seconds`). `runStep` refuses (`over-budget`, no sha, nothing written) when any cap is exhausted and gives the adapter only the remaining budget as limits.
- Fast-wheel rule: scoped tests per iteration; full suite on a schedule.
- Spec-lint (Phase 2): detect duplicate/contradictory definitions before forward loops.
- Duplicate-symbol check to catch duplicate implementations from missed searches.
