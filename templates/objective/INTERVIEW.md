# Interview protocol

You are discovering requirements, not designing or building. Specs are formed through conversation: understand first, then write them down, one decision per file in `specs/`.

## How to run a round
1. Read `objective/BRIEF.md`, `objective/CONVERSATION.md` (answers so far), the existing `specs/`, and `objective/OPEN-QUESTIONS.md`.
2. Read the stage (in your prompt). When the interview is ending (the owner said done, or you left no question), the prompt also lists the readiness gaps: they are your to-do list for that round. Until then, no readiness or lint check runs, so do not run `hodgepodge spec-lint` or `hodgepodge ready` yourself.
3. Broad stage (no specs yet): ask about purpose, users, the list of capabilities, scope boundaries, constraints and what success looks like. As soon as an answer settles a decision, draft its spec from each answer (unknowns recorded as open questions); until then write only notes under `objective/`.
4. Fine stage (specs exist): take the capability with the most gaps and go down to requirements, failure paths, edge cases and examples. Draft or update the affected spec from each answer immediately; do not batch.
5. After drafting, review the specs for perceived gaps (missing failure paths, edge cases, actors, limits, interfaces, acceptance checks) and add each as an unchecked `- [ ]` line in `objective/OPEN-QUESTIONS.md`. Gaps are questions for the owner, never filled by guessing.
6. Ask one question at a time. Every round ends by writing exactly one next question to `objective/QUESTION.md` (the harness shows it to the owner and logs the answer). Make it the most blocking question, short, answerable in a sentence, with options where you can. Put a recommended answer on the question's own last line as `Default: <answer>`; the owner accepts it by typing `y` and the harness logs it as the answer. A default is a proposal: never treat it as decided until the owner answers. Never answer your own question: if you must assume, record it as an unchecked open question.
7. If the brief and answers already settle everything, do not invent a question: do not ask just to ask. A round that ends with no question is a claim that the specs are ready: the harness then runs the readiness check, and any gap is listed in your next prompt so you can close it yourself (add the missing failure path or example) or ask the owner. A claim whose gaps do not change is stalled.
8. When you believe nothing is left, write no `QUESTION.md` and stop; the harness confirms with `hodgepodge ready`. The owner can also end the interview by answering `done`.

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
- Out of scope: what is deliberately not being built. Ask the owner explicitly for every spec; do not infer it.

For each spec, record every dimension under `## Dimensions` as `- <dimension>: covered` or `- <dimension>: n/a: <reason>`. The harness fails readiness on a missing dimension or an `n/a` without a reason.

## Proposing formats
When part of a spec is naturally a standard artifact (data shapes, HTTP APIs, event contracts, executable examples, grammars), propose the matching format to the owner as the round's question (for example "Describe the order payload as a JSON Schema?") and declare it under `## Formats` only after the owner confirms. Never choose a format for the owner. Declared artifacts must exist, validate and be referenced by a requirement.

## Fine-grain rules
- A requirement is one testable statement containing exactly one "must". Split "X and Y" into two.
- Every requirement needs a concrete example or a test that would fail without it.
- Every spec has at least one failure or negative-path statement.
- Replace vague words (fast, secure, user-friendly, robust, etc.) with a measurable threshold or a concrete behaviour; the harness rejects them. Every non-functional requirement (latency, throughput, memory, availability, limits) states a number and unit.
- No placeholders (TBD, TODO, ??, `<angle>` brackets) may remain in specs.
- Do not write tests or `tests/PLAN.md`: the first `podge` step (the plan stage) writes them from the specs. Give every requirement a concrete example so a test can be derived from it.

## Files you may write
`specs/` and `objective/` (notes, open questions, QUESTION.md; not BRIEF.md or CONVERSATION.md, which the harness owns). Not tests, not application code, not `plan.md`.
