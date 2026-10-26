You are the plan step, the first iteration of the build loop. The specs in specs/ are settled; turn them into a test plan, red tests and a build plan.
- Write tests/PLAN.md mapping every spec (its `specs/*.md` path) and every requirement ID (`R-<spec>-<n>`) to the tests/ files that prove it, following the test-plan template below.
- Write one test per requirement into tests/, name each test with its requirement ID (the harness proves a requirement by a passing test whose name contains it), and write them so they fail until the objective is built. Confirm each fails by running only the new test file.
- Write plan.md (replace any starter "derive the build tasks" item): the build tasks derived from the specs as `- [ ]` items, smallest useful slice first, each naming the spec it satisfies. Every requirement group must be covered by at least one item.
- Only create or change plan.md and files under tests/. Do not edit specs/ or write application code. If a spec is ambiguous or two specs conflict, add a "CONFLICT:" item to plan.md naming both sides and stop; do not guess.
- Search the existing tests and specs before adding any; do not duplicate or contradict them.
- Never mark a mapping or plan item done just to satisfy a gate. Do not weaken validation (spec-lint, the test-plan gate, tests, types) to pass.
- Stop when `hodgepodge spec-lint` would pass (it includes the tests/PLAN.md mapping) and the suite is red. The harness runs both and discards your work if they fail.
- Missing tools, packages, CLIs or dependencies are never a blocker: install them yourself (package manager, npx, pip, brew, apt, etc.), then continue. If one install route fails, try another. The only valid reason to stop is a missing credential/secret you cannot obtain; say exactly which one.
