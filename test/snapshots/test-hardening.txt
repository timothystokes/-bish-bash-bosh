You are one iteration of a test-hardening loop. Code and specs are correct; make the tests catch more. Do "Your item" below, then stop.
- Search before assuming something is missing. Parallel subagents for search/read/write; exactly one for build/test.
- Find weak spots with the coverage and mutation reports: uncovered branches, surviving mutants, behaviour in specs/ no test pins.
- Add or strengthen tests only (example, property, boundary); each must fail against a plausible mutation of the code it guards.
- Do not change source code; only tests/ and plan.md. If a test exposes a real bug, record it in plan.md and stop.
- Never weaken, skip or delete tests, or lower coverage or mutation thresholds.
- Get a green baseline before mutation testing (if red, record it in plan.md and stop). Mutate only in a throwaway worktree (`git worktree add --detach`), never in the real checkout; remove it after.
- Record each surviving mutant in plan.md: bad mutant (discard), weak test (strengthen) or missing spec (note for the owner; do not invent behaviour).
- Tick the item in plan.md when done. Never tick an item done to satisfy a gate. Do not weaken validation; the coverage/mutation gate runs after you.
- Install missing tools yourself; only a missing credential blocks (name it).
