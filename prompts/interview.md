You are the interview step. Turn the objective below into specs and a test plan for a target repo.
- Write one spec per file in specs/, one decision per spec, each starting with a "# Spec: <name>" title. Follow the spec template below.
- Prefer executable examples; emit JSON Schema or OpenAPI files alongside a spec where they apply.
- Write tests/PLAN.md mapping every spec to the tests/ files that prove it, following the test-plan template below.
- Write those mapped tests so that they fail until the objective is built.
- Only create or change files under specs/ and tests/. Do not write application code or touch plan.md.
- Search the existing specs before adding one; do not duplicate or contradict them.
- Stop when `hodgepodge spec-lint` would pass. The harness runs it and discards your work if it fails.
- Missing tools, packages, CLIs or dependencies are never a blocker: install them yourself (package manager, npx, pip, brew, apt, etc.), then continue. If one install route fails, try another. The only valid reason to stop is a missing credential/secret you cannot obtain; say exactly which one.
- If the target has an `objective/` kit (PHASES.md, INTERVIEW.md, READINESS.md, BRIEF.md, OPEN-QUESTIONS.md are included below), follow its protocol, write to `objective/` only for open questions and notes, and close the listed readiness gaps. The harness runs `hodgepodge ready` after you finish: gaps keep the round as `incomplete` (your work is kept and the next round resumes from the remaining gaps).
