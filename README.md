```
+----------------+
| BISH-BASH-BOSH |
+----------------+
```

A model-agnostic harness for delivering software with loop engineering (Ralph-style): one task per loop iteration, fresh agent context, specs and a plan file as state, and tests as gates.

Bish-Bash-Bosh holds the harness only. It operates directly on your project (the current working directory): `bish` sets up `.bish-bash-bosh/config.yml` automatically when needed, then `bish`, `bash` and `bosh` drive the build in place.

## Requirements

- Node.js >= 20 and `npm install`
- `git`
- An agent CLI (Copilot CLI, Claude Code or Codex) or an OpenAI-compatible HTTP endpoint

## Quick start

```sh
npm install
HARNESS="$PWD/bin"
cd your-project
"$HARNESS/bish"   # first run: asks for adapter/model if needed, then seeds and drafts the interview files from your README.md
```

The commands are `bish` (setup and requirements/specs), `bash` (plan), and `bosh` (build); `bish-bash-bosh` provides management commands. Because `bash` is also a system shell, invoke the planner explicitly as `"$HARNESS/bash"` (that is, `/path/to/bish-bash-bosh/bin/bash`), and the other commands as `"$HARNESS/bish"` and `"$HARNESS/bosh"`. The bare command names below are shorthand for those explicit paths. Avoid `npm link` or putting the harness's `bin/` first on `PATH`: that can shadow the shell used by scripts and agents.

Run `bish` directly: if `.bish-bash-bosh/config.yml` is missing, it asks for one adapter/model pair (numbered suggestions or your own values), writes the config, and commits it when possible; otherwise it prints manual commit guidance. Blank input or EOF during setup aborts without writing config or interview templates. Existing config is validated and reused without setup prompts; invalid or unreadable config is an error, never silently replaced. `bish --reverse` uses the same automatic setup before its normal reverse flow. There is no separate setup command and no scaffolding of a target repo, runtime copy, or launcher scripts. The commands take no config, repo or objective flags, and no `--dir`:

```sh
bish            # requirements and specs: requires a README.md in the project root; the first run seeds .bish-bash-bosh/interview.md and specification.md from their templates, then makes one agent call (prompts/initial-spec.md) that reads README.md to draft a baseline specification and the initial questions, and stops for review; run again to start the Interview Loop, which asks each unanswered question from interview.md one at a time (any existing default is shown in grey ahead of the cursor — Enter accepts it as-is and recolors it to match the `A:` label, any other key clears it in one go and the new answer is typed in that same color), shows "Thinking..." followed by the agent's own live reasoning text streamed on the next line in the same grey (the very first round of a brand-new session also prefaces prompts/interview-intro.md once, never again), then hands each answered round to the agent, and keeps going until every question is answered (or `bish --reverse` to derive specs from code)
bash             # plan: the first run seeds .bish-bash-bosh/plan.md from its template then runs the Plan Loop in the same invocation, which hands each unprocessed specification.md item to the agent one at a time until plan.md covers every item
bosh            # build: requires plan.md (run `bash` first); runs the Build Loop, which for each unprocessed plan.md item runs a fresh-context build agent call (writes a failing test, then implements it), gates on bosh's own code running the bundled test harness, then a fresh-context QA agent call, then that gate again, before ticking the item
```

Add `--debug` (or set `BISH_BASH_BOSH_DEBUG=1`) to `bish`, `bash` or `bosh` to log to stdout each agent prompt, the agent process raw stdout/stderr live (the Copilot adapter omits events flagged `"ephemeral":true`), each call's exit status, changed files and parsed transcript, and stack traces. The transcript is whatever the agent printed, so review debug logs before sharing them.

While a loop runs, open a second terminal in the project and run `bish-bash-bosh console bish` (or `bosh`): each line you type is queued in `more-questions.md` (bish assesses it and adds it to the open questions in its next round) or `more-todos.md` (bosh's end-of-session checklist adds it to `plan.md` before assessing the next item). The console is plain (no model, no lock); entries are consumed after a successful round or item and kept after a failed or gated one. `/quit` or Ctrl-D ends it.

`bish`, then `bash`, then `bosh` is the whole flow: bish, bash, bosh, aka bish-bash-bosh.

`bish`, `bash`, `bosh`, `status` and `tui` always operate on the current directory (`--run-id`, and `--control` for `status`/`tui`, are the only other flags). `spec-lint`, `ready`, `sync` and `promote` default to the current directory too, or take `--repo <dir>` for a one-shot operation against a different repo.

The very first `bish` run in a project writes `.bish-bash-bosh/interview.md` (the question-and-answer store) from `templates/interview-template.md`, `.bish-bash-bosh/specification.md` from `templates/specification-template.md`, and an empty `.bish-bash-bosh/bish-log.md`, then makes one agent call (`prompts/initial-spec.md`) that reads the project's `README.md` (required; `bish` refuses to start without it) to write a baseline specification and the initial questions into those two files, and exits so you can review them. Run `bish` again to start the Interview Loop: each question is a single line, `N. [ ] Q: <question> A: <answer>`; it finds the first line not yet checked, shows its question in colour, reads one line of stdin (on a real terminal, any existing answer is shown in grey as a suggestion ahead of the cursor, not actually in the editable line — Enter alone accepts it verbatim, recoloring it to the `A:` label's own color as it's accepted, any other keypress clears it all at once and the owner's own typing then inherits that same color; piped input instead treats an empty line as accepting that default), writes the final answer back into that line (its checkbox still unticked), then shows "Thinking..." followed by the agent's own live reasoning text streamed on the next line in the same grey as it arrives (the adapter contract's opt-in `onReasoning` callback, see `specs/adapters.md`) before handing the question and answer to the agent (one call per round, prefaced by `prompts/interview-loop.md`'s instructions: update `specification.md`, add further questions with sensible defaults if needed, stop — the very first round of a brand-new session also prefaces `prompts/interview-intro.md` above all of that, once only, never again for a later round or a restart that resumes the same session), ticks the line's checkbox only once that round is fully processed, and repeats; EOF pauses so a rerun resumes. Every round appends two plain-text lines to `bish-log.md` — `[<timestamp>] bish: <the full prompt sent>` and, only if the agent streamed any reasoning text, `[<timestamp>] agent: <the full text it streamed>` — never raw JSON. One native agent session carries across every round and across separate `bish` invocations (persisted to the `bishSession` field in `.bish-bash-bosh/config.yml`, a name distinct from other phases since only the Interview Loop uses it), so the agent keeps the conversation's context rather than starting fresh each round.

`bash` refuses to run (exit 2) until `.bish-bash-bosh/specification.md` exists (run `bish` first). The very first `bash` run after that writes `.bish-bash-bosh/plan.md` from `templates/plan-template.md` and an empty `.bish-bash-bosh/bash-log.md`, then falls straight through into the Plan Loop in the same invocation — unlike `bish`'s interview seed, nothing here needs the owner to review or answer anything first, so there's no second run to kick off. The Plan Loop: each `specification.md` item is a single line, `N. [ ] C: <constraint> B: <benefit>`; it finds the first line not yet checked, shows its constraint in colour, shows "Thinking..." followed by the agent's own live reasoning text streamed on the next line in the same grey as it arrives, then hands the constraint and benefit to the agent (one call per item, prefaced by `prompts/plan-loop.md`'s instructions: turn the item into dependency-ordered checklist items in `plan.md` — the very first item of a brand-new session also prefaces `prompts/plan-intro.md` above all of that, once only, never again for a later item or a restart that resumes the same session), ticks the item's checkbox once the agent has finished, and repeats until none remain; like the Build Loop below, there is no pause state, every unprocessed item is handed to the agent in one run. Every item appends the same two kinds of plain-text lines to `bash-log.md` as `bish-log.md` above. One native agent session carries across every item and across separate `bash` invocations (persisted to the `bashSession` field in `.bish-bash-bosh/config.yml`, named distinctly from `bishSession` since only the Plan Loop uses it).

`bosh` refuses to run (exit 2) until `.bish-bash-bosh/plan.md` exists (run `bash` first). The first `bosh` run creates an empty `.bish-bash-bosh/bosh-log.md`, seeds `.bish-bash-bosh/test-harness.js` from `templates/test-harness.js` (a pure-Node `node:test`/`node:assert` black-box verification harness — `runCommand` and `httpRequest` helpers plus a re-exported `assert`, works for any language the project is built in since it only exercises external behaviour, never internals) and creates `.bish-bash-bosh/tests/`, then runs the Build Loop: each `plan.md` item is a single numbered line, `<n>. [ ] Phase: <phase> Task: <task> Depends: <item numbers or None>`; it finds the first unchecked line whose dependencies are all ticked (a cycle stops the run as blocked) and shows its phase and task in colour. Unlike `bish`/`bash`, `bosh` never carries a continuing agent session — every call below is a fresh context with no memory of any earlier call, relying on `plan.md`'s ticked items and the project's own files instead. For that item: shows "Thinking..." then calls the agent once (prefaced by `prompts/build-loop.md`'s instructions: write a failing test under `.bish-bash-bosh/tests/` using the bundled harness, then implement until it passes); bosh's own code then runs the full `.bish-bash-bosh/tests/` suite as a gate — on failure it stops immediately (exit 1), leaving the item unticked so the next `bosh` run retries it from scratch; if that passes, shows "Verifying..." then calls the agent once more (prefaced by `prompts/qa-loop.md`'s instructions: independently check the implementation against `interview.md`/`specification.md`/`plan.md` and the source, fixing any bug found directly, never weakening a test); bosh's code runs the full suite again as the final gate, same failure handling. Only once both gates pass does it tick the item's checkbox, and repeat until none remain. Every agent call appends the same two kinds of plain-text lines to `bosh-log.md` as `bish-log.md` above. Run `bish-bash-bosh --help` for every command.

Specs may declare machine-checked formats in a `## Formats` section (`- <format>: <path>`), checked by `bish-bash-bosh ready` and the loop's `formats` gate. Known formats: `gherkin`, `json-schema`, `openapi`.

When a spec declares a format, `bish` adds that format's skill snippet (`prompts/formats/<format>.md`) to the interview prompt.

## Configuration

`.bish-bash-bosh/config.yml` (YAML, at the project root) is validated against `src/config.schema.json`. The key parts (run artifacts `record.json`, `usage.json`, `diagnosis.json` and `done.json` have schemas in `src/schemas/`):

- `adapter`/`model`: a single adapter and model used for every phase. Models live in config only. `bish` asks for them interactively when config is missing; hand-edit `.bish-bash-bosh/config.yml` to change them later. The agent may write anywhere in the project.
- `bishSession`: written and read by `bish`'s Interview Loop only — the opaque, adapter-defined token for its one continuing agent session (see `specs/adapters.md`); the harness rewrites it after every round, nothing else uses or reads it.
- `bashSession`: the same, but for `bash`'s Plan Loop; the harness rewrites it after every item, nothing else uses or reads it. `bosh`'s Build Loop has no such field: every build/QA call is a fresh agent context.
- `usage.json` holds wall-clock `{seconds}` per iteration, summed across a run for visibility (`bish-bash-bosh status`/`tui`). The harness does not track tokens or cost, and there is no run-wide cap: watch real spend on the model backend.

Adapters: `copilot`, `claude-code`, `codex`, `openai-http` (endpoint and key come from `BISH_HTTP_BASE_URL` / `BISH_HTTP_API_KEY`, never from config). To smoke-test an adapter live, call `runSmoke(adapter, {cwd, limits})` from `src/smoke.js` in an empty scratch directory (the agent writes and runs a FizzBuzz script; the harness re-checks it).

## Modes and commands

| Goal | Command |
|---|---|
| Capture specs from an objective (the objective is asked for, not passed) | `bish` |
| Turn specs into a plan | `bash` |
| Build from the plan, one item at a time | `bosh` |
| Derive specs and tests from existing code | `bish --reverse` |
| Check spec structure, requirement IDs and Implementation status | `bish-bash-bosh spec-lint` |

## Watching and controlling a run

```sh
bish-bash-bosh status [--control <control.json>]                              # iterations and seconds elapsed, formats, readiness, QA, done evidence
bish-bash-bosh tui    --control <control.json>                                # live view (incl. formats, readiness, QA, done): p pause, r resume, s steer, x stop, q quit
bish-bash-bosh control --file <control.json> pause|resume|stop|steer <note>   # update the status/TUI control file
```

## Safety

Commands and agents run locally with your user's permissions; there is no container isolation. Interrupt a running command with Ctrl-C. Control files remain available to the status/TUI tooling, but the Plan and Build Loops do not accept `--control`. Model traffic can be routed through `bish-bash-bosh proxy` for secret redaction and usage metering. Human approval is required before promotion (`bish-bash-bosh promote` opens a PR and never merges).

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


Thoughts:
- interview - update defaults based on new answers. litegate conflicting answers by clarification questions referencing the previous question numbers. add question numbers to the interview prompts.

- plan should reference specification numbers in all tasks.

