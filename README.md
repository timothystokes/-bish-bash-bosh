# hodgepodge

A model-agnostic harness for delivering software with loop engineering (Ralph-style): one task per loop iteration, fresh agent context, specs and a plan file as state, and tests as gates.

Hodgepodge holds the harness only. Delivery work always happens in a separate **target repo**, which `hodgepodge init` creates and `hodge` then `podge` drive for you.

## Requirements

- Node.js >= 20 and `npm install`
- `git`
- An agent CLI (Copilot CLI, Claude Code or Codex) or an OpenAI-compatible HTTP endpoint
- Docker (optional, recommended for isolated runs)

## Quick start

```sh
npm install
npx hodgepodge init --dir ~/sandboxes/demo --adapter copilot --model <model-id>
```

`init` creates `~/sandboxes/demo/target` (a git repo seeded with a toy spec, red tests and an open plan), `~/sandboxes/demo/hodge.json` (config, kept outside the repo: target repo, roles, budgets, and a `hodgepodge` reference back to this tool) and and `hodgepodge`, `hodge` and `podge` launchers. After that, `cd` into the sandbox and run the commands from there; they take no config, repo or objective flags:

```sh
cd ~/sandboxes/demo
hodge            # requirements and specs: asks for the objective, then interviews you until specs are ready (or `hodge --reverse` to derive them from code)
podge            # plan and implementation: loops until plan.md is done (use ./hodge and ./podge if they are not on your PATH)
podge step       # one iteration only
```

`hodge` then `podge` is the whole flow: hodge, then podge, aka hodgepodge.

`hodge`, `podge`, `step`, `status` and `tui` work on the sandbox in `--dir <sandbox>`, which defaults to the current directory (`--run-id`, and `--control` for `podge`/`status`/`tui`, are the only other flags). `spec-lint`, `ready`, `sync` and `promote` also default to the sandbox in the current directory.

`podge` loops one iteration at a time until the target `plan.md` is fully checked, a step fails or is gated, or a budget runs out. A ticked plan is not enough when specs declare requirement IDs: the harness runs the suite and type check, requires every `R-<spec>-<n>` to be named by a passing test, and scans source for stubs. Gaps become unchecked `Verify:` items in `plan.md` and the loop continues. The harness (not the agent) derives each spec's `Implementation:` and `Evidence:`, and writes `runs/<run-id>/done.json` with per-requirement evidence. It prints JSON `{status, steps, reason?}` and exits 0 only when done.

Use `--seed empty` to start from an empty target. Run `npx hodgepodge --help` for every command.

## Configuration

`hodge.json` is validated against `src/config.schema.json`. The key parts:

- `targetRepo` (relative to the sandbox dir), `hodgepodge` (written by `init`: where the tool lives), `allowedPaths`: where the agent works and what it may write (`init` defaults to `src/`; `--seed objective` also allows `bin/`, `lib/` and `package.json`, since a CLI entry point and its `bin` mapping are not solution-specific).
- `roles`: map roles (`build`, `interview`, `reverse`, ...) to an adapter and model. Models live in config only.
- `budgets`: `maxTokens`, `maxCostUsd`, `maxWallClockSeconds`, `maxIterations`. They are per run id and shared by `hodge` and `podge`. `init` defaults to 5,000,000 tokens, $20, 7200 s and 20 iterations (one live agent call can use over 100k tokens).
- `mode`: `forward` (default), `interview`, `reverse`, `brownfield`, `test-hardening`, `clean-room`.

Adapters: `copilot`, `claude-code`, `codex`, `openai-http` (endpoint and key come from `HODGE_HTTP_BASE_URL` / `HODGE_HTTP_API_KEY`, never from config).

## Modes and commands

| Goal | Command |
|---|---|
| Capture specs from an objective (the objective is asked for, not passed) | `hodge` |
| Build from specs (forward) | `podge` |
| One iteration only | `podge step` |
| Derive specs and tests from existing code | `hodge --reverse` |
| Rebuild from specs and tests only | `hodgepodge clean-room --source <dir> --repo <builder-dir>`, then `podge` with mode `clean-room` |
| Check spec structure, requirement IDs and Implementation status | `hodgepodge spec-lint` |

Brownfield and test-hardening loops are selected with config `mode` and run via `podge`.

## Watching and controlling a run

```sh
hodgepodge status [--control <control.json>]                              # iterations, tokens, cost vs budgets
hodgepodge tui    --control <control.json>                                # live view: p pause, r resume, s steer, x stop, q quit
hodgepodge control --file <control.json> pause|resume|stop|steer <note>   # start `podge` with --control <control.json>
hodgepodge kill --container <name> --control <control.json>              # stop the run container
```

## Running in Docker

One run is one container; the whole sandbox (`hodge.json` + `target/`) is mounted at `/sandbox`, which is the container's working directory.

```sh
docker build -t hodgepodge:dev .
docker build -f Dockerfile.agents --build-arg BASE_IMAGE=hodgepodge:dev -t hodgepodge-agents:dev .   # adds the agent CLIs
docker run --rm -v <sandbox>:/sandbox hodgepodge-agents:dev run
```

Bind-mounted paths should live under your home directory. Model traffic can be routed through `hodgepodge proxy` for secret redaction and usage metering.

## Safety

Secret redaction on model traffic, per-run budgets, a kill switch, scope and test gates, and human approval before anything is promoted out of the sandbox (`hodgepodge promote` opens a PR and never merges).

## Development

```sh
npm test       # node:test
npm run check  # tsc --checkJs
```

## Contributing and design docs

- Starting a session? Read `AGENTS.md`, then `plan.md` (names the next best action), then `specs/`.
- `specs/`: one spec per decision.
- `docs/PLAN.md`: design and rationale.
- `docs/REQUIREMENTS.md`: original requirements (goal, modes, core design, safety, deliverables, execution targets).
