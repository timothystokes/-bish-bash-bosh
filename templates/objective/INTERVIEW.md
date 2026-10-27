# Interview protocol

Discover requirements; don't design or build. The harness asks the owner; you update specs.

1. Work from the brief and this round's answers (`Q<id> ... : answer`) in your prompt; open `specs/` only as needed. Never open objective/CONVERSATION.md or objective/OPEN-QUESTIONS.md: code owns them. Don't run `spec-lint` or `ready`: when ending, the prompt lists the readiness gaps.
2. Broad stage (no specs): purpose, users, capabilities, scope, constraints, success. Fine stage: the capability with the most gaps, down to requirements, failure paths, edge cases, examples. Draft or update the spec from every answer that settles a decision.
3. End by writing `objective/RESPONSE.json`: `{"resolved":[{"id":3,"spec":"specs/x.md"}],"gaps":[{"topic":"...","question":"...","default":"..."}]}`. Resolve an id only once a spec records its answer (else it is asked again). Report each perceived gap as a gap with a proposed default (a default is a proposal, never a decision; never answer it yourself). One short question each. Code asks and tracks them in topic batches. Report none if all is settled; the harness then runs `ready`.

Dimensions, recorded per spec under `## Dimensions` as `- <dimension>: covered` or `- <dimension>: n/a: <reason>`: Actors and goals; Behaviour; Inputs and outputs; Failure paths; Edge cases; Interfaces and data; Non-functional (numeric); Constraints; Acceptance (observable); Out of scope (ask the owner for every spec).

Requirements: one testable "must" each, with an example; every spec has a failure path; no vague words or placeholders. Declare a `## Formats` artifact (JSON Schema, OpenAPI...) only after the owner agrees.

Write only `specs/`, `objective/notes` and `objective/RESPONSE.json`. No tests, code or `plan.md`.
