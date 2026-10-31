```
╷ ╷╭─╮┌─╮╭─╴┌─╴┌─╮╭─╮┌─╮╭─╴┌─╴
├─┤│ ││ ││╶┐├╴ ├─╯│ ││ ││╶┐├╴ 
╵ ╵╰─╯└─╯╰─╯└─╴╵  ╰─╯└─╯╰─╯╰─╴
```

A model-agnostic harness for delivering software with loop engineering (Ralph-style): one task per loop iteration, fresh agent context, specs and a plan file as state, and tests as gates.

Hodgepodge holds the harness only. It operates directly on your project (the current working directory): `hodgepodge init` writes `.hodgepodge/config.yml` there, then `hodge` and `podge` drive the build in place.

## Requirements

- Node.js >= 20 and `npm install`
- `git`
- An agent CLI (Copilot CLI, Claude Code or Codex) or an OpenAI-compatible HTTP endpoint
- Docker (optional, recommended for isolated runs)

## Quick start

```sh
npm install
npm link          # puts hodgepodge, hodge and podge on your PATH (or use ./bin/hodgepodge)
cd your-project
hodgepodge init   # interactive: asks which adapter/model to use for every phase (interview, reverse, build, qa)
```

`init` writes `.hodgepodge/config.yml` in the current directory (config: adapter, model); it refuses to run if `.hodgepodge/config.yml` already exists. It does no scaffolding: no target repo, no runtime copy, no launcher scripts. Then run the commands directly in your project; they take no config, repo or objective flags, and no `--dir`:

```sh
hodge            # requirements and specs: the first run seeds .hodgepodge/interview.md and spec.md from their templates (no agent call); run again to start the Interview Loop, which asks each unanswered question from interview.md one at a time (Enter accepts any default already shown), hands each answered round to the agent, and keeps going until every question is answered (or `hodge --reverse` to derive specs from code)
podge            # plan and implementation: the first step writes the test plan, red tests and plan.md; then loops until plan.md is done
podge step       # one iteration only (hodge/podge/podge step share one lock per project: a second run is refused while the first lives)
```

Add `--debug` (or set `HODGEPODGE_DEBUG=1`) to `hodge`, `podge` or `podge step` to log to stdout each agent prompt, the agent process raw stdout/stderr live (the Copilot adapter omits events flagged `"ephemeral":true`), each call's exit status, changed files and parsed transcript, every gate result with its detail, test output on failure, and stack traces. The transcript is whatever the agent printed, so review debug logs before sharing them.

While a loop runs, open a second terminal in the project and run `hodgepodge console hodge` (or `podge`): each line you type is queued in `more-questions.md` (hodge assesses it and adds it to the open questions in its next round) or `more-todos.md` (podge's end-of-session checklist adds it to `plan.md` before assessing the next item). The console is plain (no model, no lock); entries are consumed after a successful round or step and kept after a failed or gated one. `/quit` or Ctrl-D ends it.

`hodge` then `podge` is the whole flow: hodge, then podge, aka hodgepodge.

`hodge`, `podge`, `step`, `status` and `tui` always operate on the current directory (`--run-id`, and `--control` for `podge`/`status`/`tui`, are the only other flags). `spec-lint`, `ready`, `sync` and `promote` default to the current directory too, or take `--repo <dir>` for a one-shot operation against a different repo.

`podge` loops one iteration at a time until `plan.md` is fully checked, a step fails or is gated, or a `--control` stop is set (there is no run-wide budget: a stuck loop needs a stop, an agent/gate failure, or the QA cycle limit to end). A ticked plan is not enough when specs declare requirement IDs: the harness runs the suite and type check, requires every `R-<spec>-<n>` to be named by a passing test, and scans source for stubs. Gaps become unchecked `Verify:` items in `plan.md` and the loop continues. The harness (not the agent) derives each spec's `Implementation:` and `Evidence:`, and writes `.hodgepodge/runs/<run-id>/done.json` with per-requirement evidence. A step that fails or gates also writes `.hodgepodge/runs/<run-id>/iterations/NNN/diagnosis.json` (root cause, evidence, fix, test, prevention; the agent can override fields with a fenced `diagnosis` JSON block) and `reason` carries the root cause. With `maxQaCycles` set in config, a verified plan is done only after an independent, read-only QA cycle (the same configured adapter/model, run as a separate instance) reports no findings. Findings (classified `violated-decision`, `unimplemented-requirement` or `decision-needing-replacement`, each with severity, spec, consequence and a root-cause/evidence/fix/test/prevention diagnosis) are appended to `plan.md` as unchecked `QA-<cycle>-<n>` items under `## QA findings`, the build agent fixes them, and QA re-checks, at most `maxQaCycles` (default 5) times; a QA reply without a `findings` block fails the loop. QA records go to `.hodgepodge/runs/<run-id>/qa-N/`. It prints JSON `{status, steps, reason?, qa?}` and exits 0 only when done.

The very first `hodge` run in a project writes `.hodgepodge/interview.md` (the question-and-answer store) from `templates/interview-template.md` and `.hodgepodge/spec.md` from `templates/spec-template.md`, then exits — no agent call. Run `hodge` again to start the Interview Loop: it finds the first question in `interview.md` with both its `Q` and `A` checkboxes unticked, shows it in colour, reads one line of stdin (Enter alone keeps the text already after `A:` as the answer), ticks the `A` box with the final answer, then hands the question and answer to the agent (one call per round, prefaced by `prompts/interview-loop.md`'s instructions: update `spec.md`, add further questions with sensible defaults if needed, stop), ticks the `Q` box, and repeats; EOF pauses so a rerun resumes. One native agent session carries across every round and across separate `hodge` invocations (persisted to `.hodgepodge/interview-session.json`, not committed), so the agent keeps the conversation's context rather than starting fresh each round. Run `hodgepodge --help` for every command.

Specs may declare machine-checked formats in a `## Formats` section (`- <format>: <path>`), checked by `hodgepodge ready` and the loop's `formats` gate. Known formats: `gherkin`, `json-schema`, `openapi`.

When a spec declares a format, `hodge` adds that format's skill snippet (`prompts/formats/<format>.md`) to the interview prompt.

## Configuration

`.hodgepodge/config.yml` (YAML, at the project root) is validated against `src/config.schema.json`. The key parts (run artifacts `record.json`, `usage.json`, `diagnosis.json` and `done.json` have schemas in `src/schemas/`):

- `adapter`/`model`: a single adapter and model used for every phase (interview, reverse, build, qa). Models live in config only. `init` asks for them interactively; hand-edit `.hodgepodge/config.yml` to change them later. The agent may write anywhere in the project; the plan step and test-hardening mode are the only places scope is restricted (to `plan.md`/`tests/`, and `tests/` only, respectively — structural, not configurable).
- `maxQaCycles`: optional, no default; set it to enable the QA cycle (the most cycles `podge` runs before giving up).
- `usage.json` holds wall-clock `{seconds}` per iteration, summed across a run for visibility (`hodgepodge status`/`tui`). The harness does not track tokens or cost, and there is no run-wide cap: watch real spend on the model backend.
- `mode`: `forward` (default), `interview`, `reverse`, `brownfield`, `test-hardening`, `clean-room`.

Adapters: `copilot`, `claude-code`, `codex`, `openai-http` (endpoint and key come from `HODGE_HTTP_BASE_URL` / `HODGE_HTTP_API_KEY`, never from config). To smoke-test an adapter live, call `runSmoke(adapter, {cwd, limits})` from `src/smoke.js` in an empty scratch directory (the agent writes and runs a FizzBuzz script; the harness re-checks it).

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
hodgepodge status [--control <control.json>]                              # iterations and seconds elapsed, formats, readiness, QA, done evidence
hodgepodge tui    --control <control.json>                                # live view (incl. formats, readiness, QA, done): p pause, r resume, s steer, x stop, q quit
hodgepodge control --file <control.json> pause|resume|stop|steer <note>   # start `podge` with --control <control.json>
hodgepodge kill --container <name> --control <control.json>              # stop the run container
```

## Running in Docker

One run is one container; the project directory (`.hodgepodge/config.yml` + the project's own files) is bind-mounted into the container, which is the container's working directory.

```sh
docker build -t hodgepodge:dev .
docker build -f Dockerfile.agents --build-arg BASE_IMAGE=hodgepodge:dev -t hodgepodge-agents:dev .   # adds the agent CLIs
docker run --rm -v <project>:/workspace hodgepodge-agents:dev run
```

Bind-mounted paths should live under your home directory. Model traffic can be routed through `hodgepodge proxy` for secret redaction and usage metering.

## Safety

Secret redaction on model traffic, a `--control` stop/kill switch, scope and test gates, and human approval before anything is promoted out of the project (`hodgepodge promote` opens a PR and never merges).

## Development

```sh
npm test       # node:test
UPDATE_SNAPSHOTS=1 npm test   # after a deliberate prompt edit: rewrite test/snapshots/ (rendered prompts)
npm run check  # tsc --checkJs
```

## Contributing and design docs

- Loops stay small: each iteration gets one `plan.md` item plus spec pointers, never whole files (budgets in `specs/loop.md`).
- Starting a session? Read `AGENTS.md`, then `plan.md` (names the next best action), then `specs/`.
- `specs/`: one spec per decision.
- `docs/PLAN.md`: design and rationale.
- `docs/REQUIREMENTS.md`: original requirements (goal, modes, core design, safety, deliverables, execution targets).
