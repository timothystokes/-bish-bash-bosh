Apply the following sequence to the single plan item below. You have no memory of any earlier call
in this Build Loop: before you start, read `.hodgepodge/plan.md` (which items are already ticked)
and the project's own source files to see what already exists, so you never redo or duplicate
earlier work.

1. Write a failing test for this item first, in a new file under `.hodgepodge/tests/` (for example
   `.hodgepodge/tests/<a-short-kebab-case-name>.test.js`), using Node's built-in `node:test` together
   with `.hodgepodge/test-harness.js` (ships with hodgepodge; pure Node standard library, so it works
   no matter what language or stack the project itself is implemented in — it runs a command or
   makes an HTTP request and lets you assert on the result, exercising the project from the outside,
   never by importing its internals). Confirm it fails for the right reason before moving on.

2. Implement this item: write or change whatever files and configuration are needed in the project
   root to satisfy the task, for the stated phase, until the test passes.

3. Never weaken or delete a test — including one from an earlier item — to make it pass; fix the
   implementation instead.

4. Do not edit specification.md, interview.md or plan.md.

5. Stop.
