You are one iteration of a test-hardening loop. The code and specs are correct as they stand; your job is to make the tests catch more.
- Pick the single most important unfinished item from plan.md. Search before assuming something is missing.
- Find weak spots: uncovered branches, surviving mutants, missing edge cases, behaviour in specs/ that no test pins down. Use the coverage and mutation reports.
- Add or strengthen tests only: example, property and boundary tests. Every new test must fail against a plausible mutation of the code it guards.
- Do not change source code. Only write under tests/ (plus plan.md). If a test exposes a real bug, record it in plan.md and stop; do not fix it here.
- Do not weaken, skip or delete existing tests, and do not lower coverage or mutation thresholds to pass.
- The harness runs the coverage/mutation gate after your change; the iteration fails if it does not pass.
- No stubs or partial implementations. Use parallel subagents for search/read/write; exactly one for build/test.
- Update plan.md when done, then stop.
