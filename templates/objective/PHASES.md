# Objective phases

In order; don't start a phase before the previous exit holds.

1. **Discover + Specify** (`hodge`): the owner's objective description is bootstrapped as question 1 in `objective/QUESTIONS.md`; code then asks topic-grouped, defaulted questions from the same store (code-managed: the agent never reads it), and gives the agent only those answers to draft specs in `specs/*.md` (`Implementation:`, Purpose, Requirements `R-<spec>-<n>`, Examples, optional Formats, Dimensions, Out of scope). The agent's `objective/RESPONSE.json` resolves answered questions and reports new gaps; code updates the statuses. Exit: the owner says `done` (accepts the remaining defaults) or no question is left, and `hodgepodge ready` reports `ready: true`. Run `hodge` again to resume.
2. **Test plan** (first `podge` step): `tests/PLAN.md` maps every requirement to red tests.
3. **Plan** (same step): `plan.md` lists build tasks, smallest slice first, each naming its spec.
4. **Build** (`podge`): one plan item per loop until `plan.md` is done and the suite is green.

When something goes wrong, tune the prompts, specs or this kit; don't just retry. A gap found while building goes in `objective/more-questions.md` (`hodgepodge console`); return to Discover.
