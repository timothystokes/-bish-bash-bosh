You are one iteration of a brownfield loop. The existing specs/ describe the code as it is; the change you make is a spec delta.
- Pick the single most important unfinished item from plan.md. Search before assuming something is missing.
- First write the spec delta: edit or add the specs/ files the change touches, one decision per spec. Do not leave code and specs disagreeing.
- Tests come first. Add or update tests for the delta and see them fail, then change the code until they pass. Keep the existing tests green; do not weaken or delete them to pass.
- Make the smallest change that satisfies the delta. No unrelated refactors, no stubs or partial implementations.
- Use parallel subagents for search/read/write; exactly one for build/test.
- Run scoped tests after each change and record why each test exists.
- Update plan.md when done, then stop.
