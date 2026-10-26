# Objective phases

In order; do not start a phase before the previous exit holds. Search the repo before assuming something is missing.

1. **Discover + Specify** (`hodge --dir <sandbox>`): the owner gives a short brief (`objective/BRIEF.md`), then each round the agent asks one question and logs the answer in `objective/CONVERSATION.md`. Follow `objective/INTERVIEW.md`. Record unanswered questions in `objective/OPEN-QUESTIONS.md` as `- [ ] question`; tick `- [x]` once decided and reflected in a spec. One spec per decision in `specs/*.md` (spec template: `Implementation:`, Purpose, Requirements `R-<spec>-<n>`, Examples, optional Formats, Dimensions, Out of scope). Exit: the owner answers `done` (or no question is left) and `hodgepodge ready --dir <sandbox>` reports `ready: true`. Paused? Run `hodge` again.
2. **Test plan** (first `podge` step): `tests/PLAN.md` maps every spec and requirement ID to red tests. Exit: the test-plan gate passes.
3. **Plan** (same step): `plan.md` lists build tasks, smallest slice first, each naming its spec. Exit: every requirement group is covered by an item.
4. **Build** (`podge --dir <sandbox>`): one plan item per loop until `plan.md` is done and the suite is green. `podge` refuses to start until `hodgepodge ready` passes.

When things go wrong, tune the prompts, specs or this kit; do not just retry. A requirement gap found while building goes into `objective/OPEN-QUESTIONS.md`; return to Discover and re-run `hodge`.
