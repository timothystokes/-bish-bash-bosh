Apply the following sequence to the single specification item below.

1. Append or adjust `.bish-bash-bosh/plan.md`'s checklist based on this item, organised into phases, one
   numbered line per item: `<n>. [ ] Phase: words... Task: words... Depends: <item numbers, comma separated, or None>`.
   Numbers are unique, start at 1 and increase down the file; `Depends` lists the numbers of the items that must be
   done before this one can start (never itself, no cycles). Each item small enough to implement and verify in one build loop ideally no more than 5 mins of work.

2. Re-order the items in the `.bish-bash-bosh/plan.md` file based on priority and dependencies, so that every item comes after the items it depends on; renumber them in order and update every `Depends` to match. Do not implement anything yet, and do not edit `.bish-bash-bosh/specification.md` or `.bish-bash-bosh/interview.md`.

3. Stop.
