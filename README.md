```
╷ ╷╭─╮┌─╮╭─╴┌─╴┌─╮╭─╮┌─╮╭─╴┌─╴
├─┤│ ││ ││╶┐├╴ ├─╯│ ││ ││╶┐├╴ 
╵ ╵╰─╯└─╯╰─╯└─╴╵  ╰─╯└─╯╰─╯└─╴
```

A model-agnostic harness for delivering software with loop engineering (Ralph-style): one task per loop iteration, fresh agent context, specs and a plan file as state, and tests as gates.

Hodgepodge holds the harness only. It operates directly on your project (the current working directory): `hodgepodge init` writes `.hodgepodge/config.yml` there, then `hodge`, `gepo` and `podge` drive the build in place.

## Requirements

- Node.js >= 20 and `npm install`
- `git`
- An agent CLI (Copilot CLI, Claude Code or Codex) or an OpenAI-compatible HTTP endpoint
- Docker (optional, recommended for isolated runs)

## Quick start

```sh
npm install
npm link          # puts hodgepodge, hodge, gepo and podge on your PATH (or use ./bin/hodgepodge)
cd your-project
hodgepodge init   # interactive: asks which adapter/model to use for every phase
```

`init` writes `.hodgepodge/config.yml` in the current directory (config: adapter, model); it refuses to run if `.hodgepodge/config.yml` already exists. It does no scaffolding: no target repo, no runtime copy, no launcher scripts. Then run the commands directly in your project; they take no config, repo or objective flags, and no `--dir`:

```sh
hodge            # requirements and specs: the first run seeds .hodgepodge/interview.md and specification.md from their templates (no agent call); run again to start the Interview Loop, which asks each unanswered question from interview.md one at a time (any existing default is shown in grey ahead of the cursor — Enter accepts it as-is and recolors it to match the `A:` label, any other key clears it in one go and the new answer is typed in that same color), shows "Thinking..." followed by the agent's own live reasoning text streamed on the next line in the same grey (the very first round of a brand-new session also prefaces prompts/interview-intro.md once, never again), then hands each answered round to the agent, and keeps going until every question is answered (or `hodge --reverse` to derive specs from code)
gepo             # plan: the first run seeds .hodgepodge/plan.md from its template then runs the Plan Loop in the same invocation, which hands each unprocessed specification.md item to the agent one at a time until plan.md covers every item
podge            # build: requires plan.md (run `gepo` first); runs the Build Loop, which for each unprocessed plan.md item runs a fresh-context build agent call (writes a failing test, then implements it), gates on podge's own code running the bundled test harness, then a fresh-context QA agent call, then that gate again, before ticking the item
```

Add `--debug` (or set `HODGEPODGE_DEBUG=1`) to `hodge`, `gepo` or `podge` to log to stdout each agent prompt, the agent process raw stdout/stderr live (the Copilot adapter omits events flagged `"ephemeral":true`), each call's exit status, changed files and parsed transcript, and stack traces. The transcript is whatever the agent printed, so review debug logs before sharing them.

While a loop runs, open a second terminal in the project and run `hodgepodge console hodge` (or `podge`): each line you type is queued in `more-questions.md` (hodge assesses it and adds it to the open questions in its next round) or `more-todos.md` (podge's end-of-session checklist adds it to `plan.md` before assessing the next item). The console is plain (no model, no lock); entries are consumed after a successful round or item and kept after a failed or gated one. `/quit` or Ctrl-D ends it.

`hodge`, then `gepo`, then `podge` is the whole flow: hodge, gepo, podge, aka hodgepodge.

`hodge`, `gepo`, `podge`, `status` and `tui` always operate on the current directory (`--run-id`, and `--control` for `status`/`tui`, are the only other flags). `spec-lint`, `ready`, `sync` and `promote` default to the current directory too, or take `--repo <dir>` for a one-shot operation against a different repo.

The very first `hodge` run in a project writes `.hodgepodge/interview.md` (the question-and-answer store) from `templates/interview-template.md`, `.hodgepodge/specification.md` from `templates/specification-template.md`, and an empty `.hodgepodge/hodge-log.md`, then exits — no agent call. Run `hodge` again to start the Interview Loop: each question is a single line, `N. [ ] Q: <question> A: <answer>`; it finds the first line not yet checked, shows its question in colour, reads one line of stdin (on a real terminal, any existing answer is shown in grey as a suggestion ahead of the cursor, not actually in the editable line — Enter alone accepts it verbatim, recoloring it to the `A:` label's own color as it's accepted, any other keypress clears it all at once and the owner's own typing then inherits that same color; piped input instead treats an empty line as accepting that default), writes the final answer back into that line (its checkbox still unticked), then shows "Thinking..." followed by the agent's own live reasoning text streamed on the next line in the same grey as it arrives (the adapter contract's opt-in `onReasoning` callback, see `specs/adapters.md`) before handing the question and answer to the agent (one call per round, prefaced by `prompts/interview-loop.md`'s instructions: update `specification.md`, add further questions with sensible defaults if needed, stop — the very first round of a brand-new session also prefaces `prompts/interview-intro.md` above all of that, once only, never again for a later round or a restart that resumes the same session), ticks the line's checkbox only once that round is fully processed, and repeats; EOF pauses so a rerun resumes. Every round appends two plain-text lines to `hodge-log.md` — `[<timestamp>] hodge: <the full prompt sent>` and, only if the agent streamed any reasoning text, `[<timestamp>] agent: <the full text it streamed>` — never raw JSON. One native agent session carries across every round and across separate `hodge` invocations (persisted to the `hodgeSession` field in `.hodgepodge/config.yml`, a name distinct from other phases since only the Interview Loop uses it), so the agent keeps the conversation's context rather than starting fresh each round.

`gepo` refuses to run (exit 2) until `.hodgepodge/specification.md` exists (run `hodge` first). The very first `gepo` run after that writes `.hodgepodge/plan.md` from `templates/plan-template.md` and an empty `.hodgepodge/gepo-log.md`, then falls straight through into the Plan Loop in the same invocation — unlike `hodge`'s interview seed, nothing here needs the owner to review or answer anything first, so there's no second run to kick off. The Plan Loop: each `specification.md` item is a single line, `N. [ ] C: <constraint> B: <benefit>`; it finds the first line not yet checked, shows its constraint in colour, shows "Thinking..." followed by the agent's own live reasoning text streamed on the next line in the same grey as it arrives, then hands the constraint and benefit to the agent (one call per item, prefaced by `prompts/plan-loop.md`'s instructions: turn the item into dependency-ordered checklist items in `plan.md` — the very first item of a brand-new session also prefaces `prompts/plan-intro.md` above all of that, once only, never again for a later item or a restart that resumes the same session), ticks the item's checkbox once the agent has finished, and repeats until none remain; like the Build Loop below, there is no pause state, every unprocessed item is handed to the agent in one run. Every item appends the same two kinds of plain-text lines to `gepo-log.md` as `hodge-log.md` above. One native agent session carries across every item and across separate `gepo` invocations (persisted to the `gepoSession` field in `.hodgepodge/config.yml`, named distinctly from `hodgeSession` since only the Plan Loop uses it).

`podge` refuses to run (exit 2) until `.hodgepodge/plan.md` exists (run `gepo` first). The first `podge` run creates an empty `.hodgepodge/podge-log.md`, seeds `.hodgepodge/test-harness.js` from `templates/test-harness.js` (a pure-Node `node:test`/`node:assert` black-box verification harness — `runCommand` and `httpRequest` helpers plus a re-exported `assert`, works for any language the project is built in since it only exercises external behaviour, never internals) and creates `.hodgepodge/tests/`, then runs the Build Loop: each `plan.md` item is a single line, `- [ ] Phase: <phase> Task: <task>`; it finds the first unchecked line and shows its phase and task in colour. Unlike `hodge`/`gepo`, `podge` never carries a continuing agent session — every call below is a fresh context with no memory of any earlier call, relying on `plan.md`'s ticked items and the project's own files instead. For that item: shows "Thinking..." then calls the agent once (prefaced by `prompts/build-loop.md`'s instructions: write a failing test under `.hodgepodge/tests/` using the bundled harness, then implement until it passes); podge's own code then runs the full `.hodgepodge/tests/` suite as a gate — on failure it stops immediately (exit 1), leaving the item unticked so the next `podge` run retries it from scratch; if that passes, shows "Verifying..." then calls the agent once more (prefaced by `prompts/qa-loop.md`'s instructions: independently check the implementation against `interview.md`/`specification.md`/`plan.md` and the source, fixing any bug found directly, never weakening a test); podge's code runs the full suite again as the final gate, same failure handling. Only once both gates pass does it tick the item's checkbox, and repeat until none remain. Every agent call appends the same two kinds of plain-text lines to `podge-log.md` as `hodge-log.md` above. Run `hodgepodge --help` for every command.

Specs may declare machine-checked formats in a `## Formats` section (`- <format>: <path>`), checked by `hodgepodge ready` and the loop's `formats` gate. Known formats: `gherkin`, `json-schema`, `openapi`.

When a spec declares a format, `hodge` adds that format's skill snippet (`prompts/formats/<format>.md`) to the interview prompt.

## Configuration

`.hodgepodge/config.yml` (YAML, at the project root) is validated against `src/config.schema.json`. The key parts (run artifacts `record.json`, `usage.json`, `diagnosis.json` and `done.json` have schemas in `src/schemas/`):

- `adapter`/`model`: a single adapter and model used for every phase. Models live in config only. `init` asks for them interactively; hand-edit `.hodgepodge/config.yml` to change them later. The agent may write anywhere in the project.
- `hodgeSession`: written and read by `hodge`'s Interview Loop only — the opaque, adapter-defined token for its one continuing agent session (see `specs/adapters.md`); the harness rewrites it after every round, nothing else uses or reads it.
- `gepoSession`: the same, but for `gepo`'s Plan Loop; the harness rewrites it after every item, nothing else uses or reads it. `podge`'s Build Loop has no such field: every build/QA call is a fresh agent context.
- `usage.json` holds wall-clock `{seconds}` per iteration, summed across a run for visibility (`hodgepodge status`/`tui`). The harness does not track tokens or cost, and there is no run-wide cap: watch real spend on the model backend.

Adapters: `copilot`, `claude-code`, `codex`, `openai-http` (endpoint and key come from `HODGE_HTTP_BASE_URL` / `HODGE_HTTP_API_KEY`, never from config). To smoke-test an adapter live, call `runSmoke(adapter, {cwd, limits})` from `src/smoke.js` in an empty scratch directory (the agent writes and runs a FizzBuzz script; the harness re-checks it).

## Modes and commands

| Goal | Command |
|---|---|
| Capture specs from an objective (the objective is asked for, not passed) | `hodge` |
| Turn specs into a plan | `gepo` |
| Build from the plan, one item at a time | `podge` |
| Derive specs and tests from existing code | `hodge --reverse` |
| Check spec structure, requirement IDs and Implementation status | `hodgepodge spec-lint` |

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
