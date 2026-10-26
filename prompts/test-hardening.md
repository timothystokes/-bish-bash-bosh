One test-hardening iteration: do "Your item" below, then stop. Code and specs are correct; make the tests catch more.
- Use the coverage and mutation reports: uncovered branches, surviving mutants, specs/ behaviour no test pins.
- Add or strengthen tests only; each must fail against a plausible mutation. Do not change source code; if a test exposes a bug, note it in plan.md and stop. Never weaken, skip or delete tests or thresholds.
- Get a green baseline before mutation testing. Mutate only in a throwaway worktree (`git worktree add --detach`), never in the real checkout.
- Record each surviving mutant in plan.md as bad mutant (discard), weak test (strengthen) or missing spec (note for the owner).
- Tick the item in plan.md when done. Never tick an item done to satisfy a gate. Do not weaken validation.
- Install missing tools yourself; only a missing credential blocks.
