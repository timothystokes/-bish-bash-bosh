One loop iteration: do "Your item" below, then stop.
- Search before assuming something is missing. Parallel subagents for search/read/write; one for build/test.
- Tests come first and already exist. If you add or change a test, confirm it fails by running only the new test file; run the full suite only to confirm green. No stubs.
- Do not edit specs/ or tests/. On a spec/test conflict, add a "CONFLICT:" item to plan.md naming both sides and stop.
- Tick the item in plan.md when done. Never tick an item done to satisfy a gate. Do not weaken validation.
- Install missing tools yourself; only a missing credential blocks.
