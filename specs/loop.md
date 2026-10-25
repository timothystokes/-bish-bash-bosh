# Spec: Loop (Ralph-style)
- `hodge step` is the single iteration unit: idempotent, reads git, runs one loop, commits, emits JSON `{sha, iteration, cost, status}`.
- One item per iteration. The agent chooses the most important item from the target's `plan.md`.
- Fresh context each iteration. Fixed stack every time: loop prompt + `specs/**` index + `plan.md`. Nothing else carries over.
- Prompt rules: search before assuming something is missing; parallel subagents for search/read/write, exactly one for build/test; run scoped tests after each change; record why each test exists.
- Run records in the target repo: `runs/<id>/{plan.md, iterations/NNN/{prompt,transcript,diff,test.json,usage.json}, control.json}`.
- Drivers: local Node `while` loop (`hodge run`); AWS Step Functions (see `cloud-driver.md`). Both only call `hodge step`.
- Failures lead to tuning prompts/specs/gates, not blind retries.
