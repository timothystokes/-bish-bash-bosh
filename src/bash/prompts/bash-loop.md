Apply the following sequence to the single specification item below.

1. Append or adjust `.bish-bash-bosh/plan.md`'s checklist based on this item, organised into phases, one
   numbered line per item: `<n>. [ ] Phase: words... Task: words... Depends: <item numbers, comma separated, or None>`.
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

3. Re-order the items in the `.bish-bash-bosh/plan.md` file based on priority and dependencies, so that every item comes after the items it depends on; renumber them in order and update every `Depends` and the chart's ids/`after` to match. Do not implement anything yet, and do not edit `.bish-bash-bosh/specification.md` or `.bish-bash-bosh/interview.md`.

4. Stop.
