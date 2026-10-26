# Readiness: when the conversation is enough

The Discover/Specify conversation ends only when requirements are captured at a fine grain. `hodgepodge ready --dir <sandbox>` checks this deterministically and prints `{ready, gaps}`; the harness (`src/readiness.js`) is the authority, not the agent's own claim. `podge` refuses to start until it passes.

Signals checked, per spec in `specs/*.md`:
- Structure: spec-lint is clean (titled, one decision per file, `Implementation: none|partial|implemented` present with evidence when not `none`, every spec mapped in `tests/PLAN.md`).
- Granularity: at least 3 requirements.
- Testable: every requirement contains "must" (or "must not").
- Atomic: no requirement contains more than one "must"; split compound ones.
- Traceable requirements: every requirement starts with a unique ID `R-<spec file name>-<n>:` and is mapped to a test in `tests/PLAN.md`.
- Vague words: no requirement (outside code spans) uses a vague word (fast, quick, secure, robust, user-friendly, easy, simple, scalable, efficient, reliable, etc.); state a measurable threshold or a concrete behaviour instead.
- Measurable non-functionals: a requirement about latency, throughput, performance, memory, availability, capacity, rate limits, concurrency, timeouts or encryption must contain a number (with its unit).
- Dimensions: each spec has a `## Dimensions` section with one bullet per interview dimension (Actors and goals, Behaviour, Inputs and outputs, Failure paths, Edge cases, Interfaces and data, Non-functional, Constraints, Acceptance, Out of scope), each `- <dimension>: covered` or `- <dimension>: n/a: <reason>`; a missing, unknown, duplicate or reason-less entry is a gap.
- Negative path: at least one requirement or example describes a failure (throws, rejects, error, invalid, fails, refuses, must not, never).
- Formats: every `## Formats` bullet (`- <format>: <path>`) names a known format whose artifact exists inside the repo, validates, and is referenced by a requirement; artifacts agree across specs (e.g. no duplicate JSON Schema `$id`, no unresolved `$ref`); a declared `-> <output path>` that exists conforms to its schema (also a loop gate).
- Boundaries: Out of scope has at least one bullet.
- Complete: no TBD, TODO, FIXME, `??` or `<angle>` placeholders outside code spans.
- Tests exist: every test file named in `tests/PLAN.md` exists.

Signals checked across the objective:
- `objective/OPEN-QUESTIONS.md` has no unchecked `- [ ]` items.

Not machine-checkable, so the interviewer must judge it and the owner reviews it before `podge`:
- A dimension marked `covered` is actually answered by the spec, and an `n/a` reason is true (the harness only checks that each is recorded).
- Each requirement traces back to something in `objective/BRIEF.md`; nothing in the brief is unaddressed.

If a threshold is wrong for this objective, change `src/readiness.js` and this file together, not the specs.
