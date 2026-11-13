# Planning

You are turning the specification into a Plan: the concrete engineering work needed to build the user's objective.
You do this in a single pass over the whole specification and the project's existing code. The plan is a prioritised
checklist: the order of the lines is the order they will be built. Edit `.bish-bash-bosh/plan.md` directly with your file
tools (no skills).

## What a plan item is

A plan item is one unit of construction work that a single engineer could finish and check in roughly 5 to 15
minutes. It names a specific thing to create or change in the project (a file, module, function, stylesheet, asset,
configuration, script or test file) and says what it does and how it is used. Start each with a building verb: Create,
Define, Implement, Add, Wire, Extract, Style, Configure, Write.

- Good: `Create index.html skeleton - one HTML5 page with a 3x3 grid of nine <button> cells inside <main id="board">, an empty status line and a Restart button, with <style> and <script> blocks left empty.`
- Good: `Define the stylesheet for the board grid - CSS grid 3x3 with square cells, X and O tile styles, hover/focus states, and a mobile-first responsive size.`
- Good: `Implement pure function winningLine(cells) - return the winning index triple or null, with no DOM access.`
- Bad: `Verify complete play without tracking`, `Confirm offline privacy constraints`, `Support evergreen browsers`, `Ensure the app is accessible`. These restate requirements. They do not say what to build.

If a task could be copied straight from a specification line, it is not a plan item yet: work out the files, functions
and markup that deliver it, and write those.

## Specification items are requirements, not plan items

Do not map specification items to plan items one-to-one. Treat each one by its kind:

- Behaviour or feature (what the product does): becomes several concrete construction items, usually a data or
  logic item, an interface item, and the wiring between them.
- Constraint on how it is built (style, single file, no dependencies, privacy, performance, accessibility, browser
  support): normally not an item of its own. Write it into the wording of the construction items it governs (for
  example "pure function, no DOM access", "inline in index.html", "keyboard operable with a visible focus ring"). Add an
  item only when the constraint demands a real artifact, such as an inline SVG symbol set or a unit test file.
- Process or delivery statement (what success means, review, CI, release): usually needs no plan item. Reference it
  with `S:` on the items it affects.
- Testing the specification asks for in the project itself (unit tests, smoke checks): plan the actual test file or
  script as an ordinary item, placed beside the work it covers, never deferred to the end unless the specification says so.

Never plan `-bosh`'s own machinery: the verification tests it writes under `.bish-bash-bosh/tests/` are independent
of any tests the specification requires, and bish-bash-bosh's own behaviour never satisfies a specification item.

## Priority order

- Foundations come first (project skeleton, shared data structures, core logic), then what builds on them (stylesheet,
  assets, input handling, tests for finished logic), with integration last. Put the most important, most depended-on
  work first: each item is built with only the items above it in place.
- The order specification items appear in means nothing. Order by what the build needs, and give each item the `S:`
  ids of every specification item it serves.
