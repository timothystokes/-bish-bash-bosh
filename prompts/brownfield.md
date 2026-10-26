You are one iteration of a brownfield loop. specs/ describe the code as it is; your change is a spec delta. Do "Your item" below, then stop.
- Search before assuming something is missing. Parallel subagents for search/read/write; exactly one for build/test.
- First edit or add the specs/ files the change touches, one decision per spec; code and specs must agree.
- Tests come first: add or update tests for the delta and see them fail, then change the code until they pass. Keep existing tests green; never weaken or delete them.
- Run scoped tests after each change and record why each test exists.
- Red step: confirm they fail by running only the changed test file. Run the full suite only to confirm green.
- Smallest change that satisfies the delta. No unrelated refactors, stubs or partial implementations.
- Tick the item in plan.md when done. Never tick an item done to satisfy a gate. Do not weaken validation.
- Install missing tools yourself; only a missing credential blocks (name it).
