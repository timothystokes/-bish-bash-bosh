```
 ╷  .   ╷   ╷        ╷   ╷        ╷  
 ├─╮╷╭─╮├─╮ ├─╮╭─╮╭─╮├─╮ ├─╮╭─╮╭─╮├─╮
-│ ││╰─╮│ │-│ │╭─┤╰─╮│ │-│ ││ │╰─╮│ │
 └─╯╵╰─╯╵ ╵ └─╯╰─╯╰─╯╵ ╵ └─╯╰─╯╰─╯╵ ╵

```

A loop engineering harness for software delivery.

## Loops

-bish [Interview & Specification]
-bash [Solution Design & Implementation Plan]
-bosh [Build/Test & Verify]

## Requirements

- Node.js >= 20 and `npm install`
- `git`
- An agent CLI (Copilot CLI, Claude Code or Codex) or an OpenAI-compatible HTTP endpoint.

## Install

```sh
npm install -g github:timothystokes/-bish-bash-bosh   # or, from a clone: npm install && npm link
```

## New Objective

1. Create a git base repository for your new objective.

2. Create a README.md file with details of your objective including all functional and non-functional requirments and constraints.

3. Run -bish command from within the folder.

The project must be a git repository. The harness (never the agents) commits, and never pushes: after the bootstrap, after each answered interview question (message: the question and answer), once when `-bash` writes the plan, and after each task `-bosh` completes (message: the task and its specification ids). Everything in the project folder is staged for those commits, so keep unrelated work out of it.


## Workflow

1. `-bish`: the Analyst reads your README.md and drafts `.bish-bash-bosh/specification.md` (starting with a `# Objective` summary) and the first questions in `.bish-bash-bosh/interview.md`, then carries straight on through the interview, asking each question in turn. Answer or accept the default; you can stop at any question and run `-bish` again to resume. Edit `specification.md` directly at any point.
2. `-bash`: the Planner turns the whole specification and the current code into a prioritised `.bish-bash-bosh/plan.md`. Review and edit it before building.
3. `-bosh`: for each unticked plan item, in order, the Test Writer writes failing tests, the Builder implements until they pass, and the Inspector checks the work. The item is then ticked and committed, and specification items are ticked when their tagged tests pass.
4. Re-run `-bosh` to resume after a failure or interruption. It picks up at the first unticked item.

### Changing direction

Nothing detects a stale plan. If the specification changes (a new `-bish` round or a manual edit), the project is changed by hand, or an item keeps failing because it is wrong or too big, delete `.bish-bash-bosh/plan.md` and run `-bash` again, then `-bosh`.

## TODO

- Add a hygene document for -bosh

- Add a best practices md or -bish

