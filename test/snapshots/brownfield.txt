One brownfield iteration: do "Your item" below, then stop. specs/ describe the code as it is; your change is a spec delta.
- Search before assuming something is missing. Parallel subagents for search/read/write; one for build/test.
- Edit the specs/ the change touches first, one decision per spec.
- Tests come first: confirm they fail by running only the changed test file; run the full suite only to confirm green. Never weaken existing tests. Smallest change, no stubs.
- Tick the item in plan.md when done. Never tick an item done to satisfy a gate. Do not weaken validation.
- Install missing tools yourself; only a missing credential blocks.
