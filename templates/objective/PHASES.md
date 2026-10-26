# Objective phases

An objective moves through these phases in order. Each phase has an exit criterion; do not start the next phase until it holds. Search the repo before assuming something is missing.

## 1. Discover (conversation)
Goal: turn `objective/BRIEF.md` into requirements captured at a fine grain.
Run `hodge --dir <sandbox>`: it asks for a short description of the objective (written to `objective/BRIEF.md`), then runs interview rounds. Each round the agent asks the owner one question; the answer is logged in `objective/CONVERSATION.md`. Questions start broad (purpose, users, capabilities, scope, constraints, success) and move to fine-grained requirements once specs exist.
Follow `objective/INTERVIEW.md`. Record every unanswered question in `objective/OPEN-QUESTIONS.md` as `- [ ] question`; tick it (`- [x]`) once decided and reflected in a spec.
Exit: discovery and specification happen together, round by round, and end when `hodgepodge ready --dir <sandbox>` reports `ready: true`. A paused conversation resumes by running `hodge` again.

## 2. Specify
Goal: one spec per decision in `specs/*.md`, following the spec template (`Implementation:` line, Purpose, Requirements with `R-<spec>-<n>` IDs, Examples, optional Formats, Dimensions, Out of scope). Prefer executable examples; emit JSON Schema or OpenAPI beside a spec where they apply.
Exit: `hodgepodge spec-lint` passes.

## 3. Test plan
Goal: `tests/PLAN.md` maps every spec and every requirement ID to the tests in `tests/` that prove it; those tests exist and are red.
Exit: the test-plan gate passes (plan exists, mapped tests exist, suite is red before the first build loop).

## 4. Plan
Goal: `plan.md` lists the build tasks derived from the specs, smallest useful slice first, each naming the spec it satisfies. The interview phase may not write `plan.md`; the first build loop (or the owner) does.
Exit: every requirement group in `specs/` is covered by at least one plan item.

## 5. Build
Goal: forward loops, one item per loop, until `plan.md` is done and the suite is green (`podge --dir <sandbox>`).
Gate: `podge` refuses to start until `hodgepodge ready` passes.

## When things go wrong
Tune the prompts, specs or this kit ("add a sign"); do not just retry. If a build loop hits a requirement gap, add it to `objective/OPEN-QUESTIONS.md`, return to Discover, and re-run `hodge`.
