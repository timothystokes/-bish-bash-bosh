# plan.md: working status

Update this file at the end of every session. Status: `todo` | `doing` | `done` | `blocked`.

## >>> Next best action
**P1-6: local driver (`hodge run`) + Dockerfile for per-run container.**
Why: all gates exist; the driver loops `runStep` until done/over-budget and is the last piece before the toy end-to-end (P1-7). It should also enable `requireTestPlan` (not yet exposed in the CLI/config).

## Phase 0: Foundations
| ID | Task | Status | Depends on |
|---|---|---|---|
| P0-1 | Scaffold repo + test/type-check wheel (`npm test`, `npm run check`) | done | |
| P0-2 | Config schema (JSON Schema): roles -> adapter + model, budgets, target repo, allowed paths | done | P0-1 |
| P0-3 | Adapter interface + contract test suite (`specs/adapters.md`) | done | P0-2 |
| P0-4 | Adapter: Copilot CLI (non-interactive) | done | P0-3 |
| P0-5 | Adapter: Claude Code | todo | P0-3 |
| P0-6 | Adapter: Codex | todo | P0-3 |
| P0-7 | Adapter: generic OpenAI-compatible HTTP | todo | P0-3 |
| P0-8 | Run-record format + writer (`specs/loop.md`) | done | P0-1 |

## Phase 1: Loop + gates
| ID | Task | Status | Depends on |
|---|---|---|---|
| P1-1 | `runStep`: one idempotent iteration (repo gate, agent call, scoped tests, commit, run record, JSON status) | done | P0-3, P0-8 |
| P1-1b | Wire `hodge step` CLI (config file, adapter registry, JSON output) | done | P1-1 |
| P1-2 | Repo gate (refuse target == hodgepodge) | done | P0-2 |
| P1-3 | Test-plan gate (plan exists, tests red first) | done | P1-1 |
| P1-4 | Type gate, anti-stub gate, scope gate | done | P1-1 |
| P1-5 | Budget gate (tokens/cost/time/iterations) | done | P1-1 |
| P1-6 | Local driver (`hodge run`) + Dockerfile for per-run container | todo | P1-1 |
| P1-7 | Toy objective end-to-end unattended, red to green | todo | P1-2..P1-6 |

## Later phases (not yet broken down)
Phase 2 spec modes (interview, forward, spec-lint); Phase 3 control + TUI + secret-scanning proxy; Phase 4 reverse/brownfield/harden/clean-room; Phase 5 AWS (CDK, Step Functions driver, Fargate Spot). See `docs/PLAN.md`. Break each down into a table like the above when the previous phase is `done`.

## Deferred
- Promotion out of the sandbox (expected to align with a traditional CD pipeline).

## Session log
- Initial planning session: requirements and plan captured; no code yet.
- P0-1 done: package.json, tsconfig (checkJs), `bin/hodge` shim -> `src/cli.js`, smoke tests (3 pass, `npm run check` clean). Learned: Node 26 `node --test test/` treats the dir as a module; use the glob `test/**/*.test.js`. Added .gitignore (node_modules). Sign: keep bin/hodge a thin shim so logic stays type-checked in src/.
- P0-2 done: `src/config.schema.json` (draft-07) + `validateConfig` in `src/config.js` via ajv (devDependency); 11 tests pass, check clean. Config keys: targetRepo, roles (must include `build`; each adapter+model opaque strings), budgets (maxTokens, maxCostUsd, maxWallClockSeconds, maxIterations), allowedPaths. Unknown keys rejected. Sign: adapter/model ids stay opaque strings, never enums, to keep vendors out of logic.
- P0-3 done: `src/adapter.js` (typedefs, `validateAdapterResult`, scripted `createFakeAdapter`) and reusable `adapterContract(name, makeAdapter)` in `test/helpers/adapter-contract.js` (success, failure-not-throw, over-limit => non-zero exit, relative changedFiles). 17 tests pass, check clean. Request shape: `{prompt, cwd, limits}`; adapters expose `run(req)`. Sign: real adapters must call `adapterContract` with a fake-agent fixture (no network); over-limit usage is reported via non-zero exitStatus.
- P0-8 done: `src/run-record.js` (`validateRunRecord`, `iterationDir`, `writeIterationRecord`), 7 new tests (24 total pass, check clean). Writes `runs/<id>/iterations/NNN/{prompt,transcript,diff,test.json,usage.json,record.json}` atomically (temp dir + rename), never overwrites, rejects unsafe runId/iteration. Statuses: ok|failed|gated|over-budget. Sign: validate before touching disk so failures leave no partial records.
- P1-2 done: `src/repo-gate.js` (`checkRepoGate`, `normalizeRepoId`, `harnessIdentity`), 6 new tests (30 total pass, check clean). Refuses by normalized remote URL (ssh/https/scp, case, .git) and by real path equal to/inside the hodgepodge root (symlinks resolved). Not yet wired into the CLI (no `hodge step` yet): P1-1 must call it first. Sign: the gate takes an injectable identity so tests never depend on this checkout's remotes.
- P0-4 done: `src/adapters/copilot.js` (`createCopilotAdapter`, `buildCopilotArgs`, `parseCopilotOutput`), fake agent `test/fixtures/fake-copilot.js`, `test/copilot-adapter.test.js` runs `adapterContract` plus args/parse/timeout/missing-binary tests (38 pass, check clean). changedFiles come from a before/after file-hash snapshot (no git needed); wall-clock limit => SIGKILL, exit 124; spawn failure => exit 127. Assumption: usage parsed from `assistant.usage` JSONL events (inputTokens/outputTokens/cost); verify against real `--output-format json` output when first run live. Sign: adapters take injectable `command`/`prefixArgs`/`env` so tests use a fake binary, never the network.
- P1-1 done: `src/step.js` (`runStep`, `buildPrompt`), `test/step.test.js` (10 new, 48 total pass, check clean; tests failed first). Flow: validate config -> repo gate on targetRepo and repoDir -> clean-tree check -> fixed prompt stack (loop prompt + specs index + plan.md) -> adapter -> scoped test command (injectable, default `npm test`) -> on failure/over-budget `git reset --hard` + clean (diff kept in the record) -> write record -> commit -> `{sha, iteration, cost, status}`. Gated steps return sha null and touch nothing. Iteration number = max existing + 1. Not yet done: CLI wiring (P1-1b), per-gate detail beyond repo/tests (P1-3..P1-5), per-run (not per-step) budget accounting. Sign: a step must start from a clean tree; discard agent work on failure but always commit the record.
- P1-1b done: `hodge step --config <file> [--repo <dir>] [--run-id <id>]` in `src/cli.js` (`main` now async, injectable deps; `parseStepArgs`), `src/adapters/index.js` (`resolveAdapter`, `defaultRegistry` maps opaque adapter ids to factories; only entry today is the Copilot adapter). `test/cli-step.test.js` 9 new (57 total pass, check clean; tests failed first). Exit codes: 0 ok, 1 step failed/gated/over-budget, 2 usage/config/adapter errors. JSON printed to stdout. Learned: bin/hodge needs top-level await on `main`. Sign: new adapters (P0-5..7) register in `defaultRegistry` only; CLI logic stays vendor-free. Untracked `loop.sh` (owner's scratch, references missing `lap.sh`) left uncommitted. AGENTS.md checklist gained step 5 (re-evaluate checklist/plan and next action).
- P1-5 done: `src/budget-gate.js` (`sumRunUsage`, `checkBudgetGate`), 9 new tests (66 total pass, check clean; tests failed first). `runStep` sums `runs/<id>/iterations/*/usage.json`, refuses with `{status:'over-budget', sha:null, reason}` and writes nothing when iterations/tokens/cost/wall-clock is exhausted, and passes the adapter the remaining run budget as limits (wall-clock also capped per step). usage.json now carries optional `seconds` (measured around the adapter call); records gain a `budget` gate entry. Budgets in config are therefore run-wide. Sign: budget accounting reads only run records, so a restarted driver cannot lose it.
- P1-4 done: `src/diff-gates.js` (`checkScopeGate`, `checkAntiStubGate`, `checkTypeGate`), `test/diff-gates.test.js` (13 new, 79 total pass, check clean; tests failed first). `runStep` takes optional `typeCommand`; scope/anti-stub run before tests, all gates recorded in `record.json`. Decisions: plan.md always in scope; markdown not stub-scanned; type gate skipped when target has no tsconfig.json (recorded as skipped). Sign: gates read staged git state, not the adapter's self-reported changedFiles.
- P1-3 done: `src/test-plan-gate.js` (`checkTestPlanGate`), `test/test-plan-gate.test.js` (7 new, 86 total pass, check clean; tests failed first). Needs `tests/PLAN.md` where each line names a `specs/*.md` and `tests/*` path; every target spec must be mapped, mapped tests must exist, and before iteration 1 of a run the suite must be red. `runStep` opt-in `requireTestPlan` returns `gated` (nothing written) on failure; records a `test-plan` gate. Not yet wired to CLI/config (do in P1-6). Sign: red-first is checked by the harness running the suite, never by trusting agent claims.
