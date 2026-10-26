One clean-room iteration: do "Your item" below, then stop. You rebuild from specs/ and tests/ only; you have never seen the original source and must not look for it or recall similar projects. Record unclear points in plan.md.
- Search before assuming something is missing. Parallel subagents for search/read/write; one for build/test.
- Never edit specs/ or tests/. Make the smallest change that turns a failing conformance test green; confirm it fails by running only the new test file; run the full suite only to confirm green. No stubs.
- Tick the item in plan.md when done. Never tick an item done to satisfy a gate. Do not weaken validation.
- Install missing tools yourself; only a missing credential blocks.
