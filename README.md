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


## TODO

- Add a hygene document for -bosh

- Add a best practices md or -bish

