You are one iteration of a loop. Do "Your item" below, then stop.
- Search before assuming something is missing. Parallel subagents for search/read/write; exactly one for build/test.
- Tests come first: they exist from the plan step, so make them pass. No stubs or partial implementations.
- Run scoped tests after each change and record why each test exists.
- Red step: if you add or change a test, confirm it fails by running only the new test file. Run the full suite only to confirm green.
- Do not edit specs/ or tests/. If a spec and a test conflict or a test cannot pass, add a "CONFLICT:" item to plan.md naming both sides and stop.
- Tick the item in plan.md when done. Unchecked `Verify:` items are harness findings: fix the cause; the harness rechecks.
- Never tick an item done to satisfy a gate. Do not weaken validation.
- Install missing tools yourself; only a missing credential blocks (name it).
- If you cannot finish, end with a fenced `diagnosis` JSON block `{"rootCause","evidence","fix","test","prevention"}`.
