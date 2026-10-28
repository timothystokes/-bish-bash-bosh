# Readiness

`hodgepodge ready` prints `{ready, gaps}`; `src/readiness.js` is the authority, not the agent's claim. `podge` refuses to start until it passes.

Per spec in `specs/*.md`:
- Structure: titled, one decision, `Implementation: none|partial|implemented` (evidence when not `none`). The test mapping is checked later by the plan step.
- At least 3 requirements, each starting with a unique `R-<spec file name>-<n>:`, testable (one "must", or "must not"), atomic.
- No vague words (fast, secure, robust, user-friendly, scalable...) outside code spans; latency, throughput, memory, availability, limits, timeouts and encryption carry a number and unit.
- `## Dimensions`: one bullet per dimension (Actors and goals, Behaviour, Inputs and outputs, Failure paths, Edge cases, Interfaces and data, Non-functional, Constraints, Acceptance, Out of scope), each `covered` or `n/a: <reason>`; missing, duplicate or reason-less is a gap.
- At least one failure or negative-path statement; Out of scope has at least one bullet.
- No TBD, TODO, FIXME, `??` or `<angle>` placeholders outside code spans.
- Each `## Formats` bullet (`- <format>: <path>`) names an existing artifact that validates and is referenced by a requirement; artifacts agree across specs.
- Known formats: `gherkin`, `json-schema`, `openapi`

Across the objective: `objective/OPEN-QUESTIONS.md` has every question's Specified box ticked.

Judged by the interviewer, reviewed by the owner: a `covered` dimension is really answered, an `n/a` reason is true, and every requirement traces to the brief.

If a threshold is wrong, change `src/readiness.js` and this file together, not the specs.
