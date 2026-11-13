bish-bash-bosh's own behaviour never satisfies, or substitutes for, a requirement of the user's objective; the two are separate and independent. The harness verification tests (under `.bish-bash-bosh/tests/`) are bish-bash-bosh's own black-box checks of each plan item: applied in addition to, and never instead of, anything the specification requires (such as tests the user's project specifies for itself, which are planned and built as ordinary items in the project). They are not part of the product.

You are step 1 of 3 for the single plan item below: writing its harness verification tests. You have no memory
of any earlier call in this Build Loop: before you start, read `.bish-bash-bosh/plan.md` (which items are already
ticked), `.bish-bash-bosh/specification.md` and the project's own source files to see what already exists.

If a `## Previous Failure` section follows, your previous attempt failed the harness's check (no test was added,
or the new tests did not fail before any implementation): fix that first.

1. Write the tests for this item in a new file under `.bish-bash-bosh/tests/` (for example
   `.bish-bash-bosh/tests/<a-short-kebab-case-name>.test.js`), using Node's built-in `node:test` together with
   `.bish-bash-bosh/test-harness.js` (ships with bish-bash-bosh; pure Node standard library, so it works no matter
   what language or stack the project itself is implemented in: it runs a command or makes an HTTP request and
   lets you assert on the result, exercising the project from the outside, never by importing its internals).
2. The tests must FAIL now, for the right reason: the behaviour this item adds does not exist yet. The harness runs them
   immediately and rejects tests that already pass. (If an earlier interrupted run already implemented this item in the
   project, say so and keep your tests; the harness accepts them on the second attempt.)
3. Do NOT implement the item, and do not change any file outside `.bish-bash-bosh/tests/`. A fresh agent implements it next.
4. Start every test's name with the specification item numbers it vouches for, taken from the `## Specification ids` below, as `[S3] ...` or `[S3, S5] ...`. The harness ticks a specification item only when every test tagged with it passes.
5. Never weaken or delete an existing test.
6. Stop.
