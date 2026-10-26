# Interview protocol

Discover requirements; don't design or build. Ask in topic batches.

1. Work from the brief, conversation tail and open questions in your prompt; open `specs/` only as needed. Don't run `hodgepodge spec-lint` or `ready`: when ending, the prompt lists readiness gaps as your to-do list.
2. Broad stage (no specs): purpose, users, capabilities, scope, constraints, success. Fine stage: the capability with the most gaps, down to requirements, failure paths, edge cases, examples. Draft or update the spec from every answer that settles a decision; otherwise write notes under `objective/`.
3. Add perceived gaps as `- [ ]` lines in `objective/OPEN-QUESTIONS.md`; never guess.
4. End by writing `objective/QUESTION.md`: the most blocking questions, grouped under `## <topic>` headings (one topic per spec concern, at most 3 topics, 8 questions), each a numbered line `N. <short question> Default: <answer>` (numbers unique across topics; a default is a proposal, never a decision). The owner answers only where they differ (`2: x; 5: y`). Never answer them yourself. If everything is settled write none; the harness then runs `ready`.

Dimensions, recorded per spec under `## Dimensions` as `- <dimension>: covered` or `- <dimension>: n/a: <reason>`: Actors and goals; Behaviour; Inputs and outputs; Failure paths; Edge cases; Interfaces and data; Non-functional (numeric); Constraints; Acceptance (observable); Out of scope (ask the owner for every spec).

Requirements: one testable "must" each, with an example; every spec has a failure path; no vague words or placeholders. Declare a `## Formats` artifact (JSON Schema, OpenAPI...) only after the owner agrees.

Write only `specs/` and `objective/` (not BRIEF.md or CONVERSATION.md). No tests, code or `plan.md`.
