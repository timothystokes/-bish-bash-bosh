# Interview protocol

Discover requirements; don't design or build. Ask one question at a time.

1. Work from the brief, conversation tail and open questions in your prompt; open `specs/` only as needed. Don't run `hodgepodge spec-lint` or `ready`: when ending, the prompt lists readiness gaps as your to-do list.
2. Broad stage (no specs): purpose, users, capabilities, scope, constraints, success. Fine stage: the capability with the most gaps, down to requirements, failure paths, edge cases, examples. Draft or update the spec from every answer that settles a decision; otherwise write notes under `objective/`.
3. Add perceived gaps as `- [ ]` lines in `objective/OPEN-QUESTIONS.md`; never guess.
4. End by writing one question to `objective/QUESTION.md`: the most blocking, short, with options, and a last line `Default: <answer>` (a proposal, never a decision). Never answer it yourself. If everything is settled write none; the harness then runs `ready`.

Dimensions, recorded per spec under `## Dimensions` as `- <dimension>: covered` or `- <dimension>: n/a: <reason>`: Actors and goals; Behaviour; Inputs and outputs; Failure paths; Edge cases; Interfaces and data; Non-functional (numeric); Constraints; Acceptance (observable); Out of scope (ask the owner for every spec).

Requirements: one testable "must" each, with an example; every spec has a failure path; no vague words or placeholders. Propose a standard format (JSON Schema, OpenAPI...) as a question; declare it under `## Formats` only after the owner agrees.

Write only `specs/` and `objective/` (not BRIEF.md or CONVERSATION.md); no tests, code or `plan.md`.
