You are the plan step. specs/ are settled.
- Write tests/PLAN.md mapping every spec and requirement ID (`R-<spec>-<n>`) to tests, per the template below.
- Write one failing test per requirement, named with its ID; confirm by running only the new test file.
- Write plan.md (replacing any starter item): `- [ ]` build tasks, smallest slice first, each naming its spec, covering every requirement.
- Change only plan.md and tests/. On ambiguous or conflicting specs add a "CONFLICT:" item to plan.md and stop.
- Never mark anything done to satisfy a gate. Do not weaken validation.
- Stop when `hodgepodge spec-lint` would pass and the suite is red.
- Install missing tools yourself; only a missing credential blocks.
