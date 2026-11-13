Plan the build in one pass.

1. Read the whole of `.bish-bash-bosh/specification.md`, then study the project's existing source files and tests. Do not assume anything is unimplemented: search the code first.
2. Do a gap analysis: what the specification requires that the code does not yet provide.
3. Write `.bish-bash-bosh/plan.md` as a prioritised checklist of concrete construction tasks, most important first. Order is build order: foundations and anything others rely on come before what uses them, and each task should leave the project in a working state.
   - One numbered line per task: `<n>. [ ] T: <short name> - <what to build: the file/function/markup/style, what it does, how it is used> S: <specification ids>`
   - Numbers are unique and start at 1. Each task is fine-grained: one concern, one new function or one file section, doable in about 5 minutes and checkable by a single small test. If a task needs "and" to describe it, or touches more than one function or file, split it (for example the page skeleton, each SVG symbol, each style rule group, each pure function, each event handler and each test file are separate tasks). Expect a typical small app to produce 15 to 30 tasks, not 5 to 10. Detail is one short sentence.
   - Keep tasks that are already ticked (`[x]`) as they are. Update, split, reorder or remove unticked tasks freely; the plan is disposable.
   - Tasks are construction work ("Create index.html with the 3x3 grid"), not restated requirements. No dependency lists, phases or charts.
4. Stop.
