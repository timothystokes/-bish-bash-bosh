# Objective phases

In order; don't start a phase before the previous exit holds.

1. **Discover + Specify** (`hodge --dir <sandbox>`): from `objective/BRIEF.md`, each round asks the owner one question (`objective/INTERVIEW.md`), logs the answer in `objective/CONVERSATION.md` and drafts specs in `specs/*.md` (`Implementation:`, Purpose, Requirements `R-<spec>-<n>`, Examples, optional Formats, Dimensions, Out of scope). Unanswered questions go in `objective/OPEN-QUESTIONS.md` as `- [ ]`; tick `- [x]` once reflected in a spec. Exit: the owner says `done` (or no question is left) and `hodgepodge ready --dir <sandbox>` reports `ready: true`. Run `hodge` again to resume.
2. **Test plan** (first `podge` step): `tests/PLAN.md` maps every requirement to red tests.
3. **Plan** (same step): `plan.md` lists build tasks, smallest slice first, each naming its spec.
4. **Build** (`podge --dir <sandbox>`): one plan item per loop until `plan.md` is done and the suite is green.

When something goes wrong, tune the prompts, specs or this kit; don't just retry. A gap found while building goes in `objective/OPEN-QUESTIONS.md`; return to Discover.
