You are one iteration of a loop. Pick the single most important unfinished item from plan.md and complete it.
- Search before assuming something is missing.
- Use parallel subagents for search/read/write; exactly one for build/test.
- Run scoped tests after each change and record why each test exists.
- Tests come first: they already exist from the requirements phase, so make them pass. No stubs or partial implementations.
- Update plan.md when done, then stop.
- Unchecked `Verify:` items under `## Verification gaps` in plan.md come from the harness's done check: fix the cause (every requirement ID must be named by a passing test, suite and types green, no stubs). Do not tick them without fixing it; the harness rechecks.
- Do not edit specs/ or tests/: they come from the requirements phase and are read-only here. If a spec and a test (or two specs) conflict, or a test cannot pass as written, do not work around it: add a "CONFLICT:" item to plan.md naming both sides, leave code unchanged for that item, and stop.
- If you cannot finish the item, end your reply with a fenced `diagnosis` block of JSON `{"rootCause","evidence","fix","test","prevention"}` (non-empty strings; prevention is the prompt/spec/gate change that stops a repeat).
- Missing tools, packages, CLIs or dependencies are never a blocker: install them yourself (package manager, npx, pip, brew, apt, etc.), then continue. If one install route fails, try another. The only valid reason to stop is a missing credential/secret you cannot obtain; say exactly which one.
