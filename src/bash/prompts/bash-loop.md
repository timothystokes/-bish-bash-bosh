Apply the following sequence to the single specification item to follow these instructions.

0. First read the whole of `.bish-bash-bosh/plan.md`. Do not simply append work for this item at the end. Decide, for
   this item, which of these apply, and do all that do:
   - Already covered by existing plan items: add this item's id to their `S:` and adjust their task detail; add no
     duplicate.
   - Partly covered or conflicting: change the existing items (task detail, `S:`, `D:`, duration), or split or merge
     them, so the plan describes the combined need.
   - New work: add items into the dependency chain where they belong: give them a `D:` on the existing items they
     need, and add them to the `D:` of existing items that need them. Where a line sits in the file does not matter
     (new items may simply take the next free number); the dependency links are what place it in the build order.
   - Existing items now depending on this new work (shared foundations, setup, data or interfaces) must have it added
     to their `D:`. Keep dependencies acyclic.
   The position of this specification item in the specification says nothing about where its work belongs in the plan.

1. Append or adjust `.bish-bash-bosh/plan.md`'s checklist based on this item, organised into phases, one
   numbered line per item: `<n>. [ ] P: <phase> T: <task> S: <specification-id(s)> D: <depends-on>`.
   Numbers are unique, start at 1 and increase down the file; `Depends` lists the numbers of the items that must be
   done before this one can start (never itself, no cycles). Each item small enough to implement and verify in one build loop ideally no more than 5 mins of work.

2. Define the plan with a Mermaid Gantt chart: keep one fenced ```mermaid `gantt` block in `.bish-bash-bosh/plan.md`
   (`dateFormat YYYY-MM-DD HH:mm`, `axisFormat %H:%M`), one `section` per phase, one task per numbered item, written as
   `<task words> :t<n>, after t<a> t<b>, <n>m` (`:t<n>, <start date> 00:00, <n>m` when Depends is None, reusing the start date of the chart's first task, as a task with no dependency needs an explicit start date or Mermaid reports "Invalid date"; `done,` before the id once ticked).
   Durations are the build agent's estimated minutes of work for that item (`5m`, `10m`, `15m`; whole minutes only,
   never `d`/`w`).
   Task names must be short labels (under 60 characters) with no `:`, `;` or `#`, as those break Mermaid's parser;
   start each numbered line's `Task:` with that same short name, then ` - ` and the full detail, so humans can match
   a line to its chart bar.
   The chart and the numbered lines must always describe the same items, ids and dependencies.

3. Don't renumber or physically reorder existing lines in `.bish-bash-bosh/plan.md` (new items may take the next free number wherever they sit). The build order is determined only by the `D:` references, so make them right.

4. Stop!

## Sepcification Item to process this time...

