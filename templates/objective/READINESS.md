# Readiness: when the conversation is enough

The Discover/Specify conversation ends only when requirements are captured at a fine grain. `hodgepodge ready --dir <sandbox>` checks this deterministically and prints `{ready, gaps}`; the harness (`src/readiness.js`) is the authority, not the agent's own claim. `podge` refuses to start until it passes.

Signals checked, per spec in `specs/*.md`:
- Structure: spec-lint is clean (titled, one decision per file, `Implementation: none|partial|implemented` present with evidence when not `none`, every spec mapped in `tests/PLAN.md`).
- Granularity: at least 3 requirements.
- Testable: every requirement contains "must" (or "must not").
- Atomic: no requirement contains more than one "must"; split compound ones.
- Traceable requirements: every requirement starts with a unique ID `R-<spec file name>-<n>:` and is mapped to a test in `tests/PLAN.md`.
- Negative path: at least one requirement or example describes a failure (throws, rejects, error, invalid, fails, refuses, must not, never).
- Boundaries: Out of scope has at least one bullet.
- Complete: no TBD, TODO, FIXME, `??` or `<angle>` placeholders outside code spans.
- Tests exist: every test file named in `tests/PLAN.md` exists.

Signals checked across the objective:
- `objective/OPEN-QUESTIONS.md` has no unchecked `- [ ]` items.

Not machine-checkable, so the interviewer must judge it and the owner reviews it before `podge`:
- Every dimension in `objective/INTERVIEW.md` was considered for each capability (record "n/a" decisions as ticked open questions).
- Each requirement traces back to something in `objective/BRIEF.md`; nothing in the brief is unaddressed.

If a threshold is wrong for this objective, change `src/readiness.js` and this file together, not the specs.
