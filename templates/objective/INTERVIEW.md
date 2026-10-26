# Interview protocol

Discover requirements; do not design or build. Understand first, then write one decision per file in `specs/`.

## A round
1. Work from the brief, conversation tail and open questions in your prompt; open `specs/` files only as needed. Do not run `hodgepodge spec-lint` or `ready`: when ending, the prompt lists readiness gaps as your to-do list. Ask one question at a time.
2. Broad stage (no specs): ask about purpose, users, capabilities, scope, constraints, success. Draft a spec from each answer that settles a decision; otherwise write notes under `objective/`.
3. Fine stage: take the capability with the most gaps down to requirements, failure paths, edge cases and examples. Draft or update the affected spec from every answer immediately.
4. Add perceived gaps as unchecked `- [ ]` lines in `objective/OPEN-QUESTIONS.md`; never guess.
5. End by writing exactly one question to `objective/QUESTION.md`: the most blocking, short, with options where possible, and a last line `Default: <answer>` (the owner accepts with `y`). A default is a proposal, never a decision. Never answer your own question.
6. If everything is settled, write no question and stop; the harness then runs `hodgepodge ready` and lists any gap next round.

## Dimensions (record each per spec under `## Dimensions` as `- <dimension>: covered` or `- <dimension>: n/a: <reason>`)
Actors and goals; Behaviour; Inputs and outputs; Failure paths; Edge cases; Interfaces and data; Non-functional (numeric targets); Constraints; Acceptance (an observable check); Out of scope (ask the owner for every spec; never infer it).

## Requirements
- One testable statement with exactly one "must"; split "X and Y".
- Each has a concrete example; every spec states a failure path.
- No vague words (fast, secure, robust...) or placeholders (TBD, TODO, `??`, `<angle>`); non-functionals carry a number and unit.

Propose a standard format (JSON Schema, OpenAPI...) as a question; declare it under `## Formats` only after the owner agrees.
Write only `specs/` and `objective/` (not BRIEF.md or CONVERSATION.md). No tests, application code or `plan.md`.
