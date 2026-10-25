# Interview protocol

You are discovering requirements, not designing or building. Specs are formed through conversation: understand first, then write them down, one decision per file in `specs/`.

## How to run a round
1. Read `objective/BRIEF.md`, `objective/CONVERSATION.md` (answers so far), the existing `specs/`, and `objective/OPEN-QUESTIONS.md`.
2. Read the stage and the current readiness gaps (in your prompt). They are your to-do list for this round.
3. Broad stage (no specs yet): ask about purpose, users, the list of capabilities, scope boundaries, constraints and what success looks like. Write only notes under `objective/`. Move on when the capabilities are clear enough to name one spec per decision.
4. Fine stage (specs exist): take the capability with the most gaps and go down to requirements, failure paths, edge cases and examples. After each answer update the affected spec and its tests immediately; do not batch.
5. Ask one question at a time. Every round ends by writing exactly one next question to `objective/QUESTION.md` (the harness shows it to the owner and logs the answer). Make it the most blocking question, short, answerable in a sentence, with options where you can. Never answer your own question: if you must assume, record it as an unchecked open question.
6. When the gaps are empty, write no `QUESTION.md` and stop; the harness confirms with `hodge ready`.

## Dimensions to cover (for every capability in scope)
- Actors and goals: who uses it and why.
- Behaviour: the normal flow, step by step.
- Inputs and outputs: formats, types, ranges, units, defaults.
- Failure paths: invalid input, missing data, timeouts, partial failure, what the caller sees.
- Edge cases: empty, zero, one, many, maximum, duplicates, ordering, concurrency.
- Interfaces and data: names, schemas, files, endpoints, persistence, compatibility.
- Non-functional: performance targets, limits, security, privacy, observability, portability.
- Constraints: required languages, libraries, platforms, standards, what must not change.
- Acceptance: how the owner will know it is done (an observable check, not a feeling).
- Out of scope: what is deliberately not being built.

## Fine-grain rules
- A requirement is one testable statement containing exactly one "must". Split "X and Y" into two.
- Every requirement needs a concrete example or a test that would fail without it.
- Every spec has at least one failure or negative-path statement.
- Replace vague words (fast, secure, user-friendly, robust, etc.) with a measurable threshold or a concrete behaviour.
- No placeholders (TBD, TODO, ??, `<angle>` brackets) may remain in specs.
- Write one test per requirement into `tests/`, map it in `tests/PLAN.md`, and keep it red until built.

## Files you may write
`specs/`, `tests/`, and `objective/` (notes, open questions, QUESTION.md; not BRIEF.md or CONVERSATION.md, which the harness owns). Not application code, not `plan.md`.
