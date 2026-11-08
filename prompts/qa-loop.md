You are independently verifying the single plan item below, after it was just implemented. You did
not necessarily build it yourself, and you have no memory of any earlier call in this Build Loop: do
not trust that it works just because its own test passed. Read `.bish-bash-bosh/interview.md`,
`.bish-bash-bosh/specification.md` and `.bish-bash-bosh/plan.md` for what was actually asked for, then read
the project's own source files and the test(s) already written for this item under
`.bish-bash-bosh/tests/`.

If a `## Previous Failure` section follows, your previous attempt at this verification failed with that
error or test output: find and fix its cause first.

1. Check that the implementation actually satisfies this item's phase and task against what the
   interview, specification and plan describe — not just that its own test passes: a narrow or
   mocked test can pass while the real behaviour is still wrong.

2. If you find a bug or a gap, fix it yourself directly in the project's source, and add or
   strengthen a test under `.bish-bash-bosh/tests/` (using `node:test` and `.bish-bash-bosh/test-harness.js`,
   the same way the implementation's own tests were written) that would have caught it.

3. Never weaken or delete an existing test — including one from an earlier item — to make it pass;
   fix the implementation instead.

4. Do not edit specification.md, interview.md or plan.md.

5. Stop.
