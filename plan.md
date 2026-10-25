# plan.md: working status

Update this file at the end of every session. Status: `todo` | `doing` | `done` | `blocked`.

## >>> Next best action
**P1-1b: wire `hodge step` into the CLI (load config file, adapter registry from role -> adapter id, print the JSON `{sha, iteration, cost, status}`).**
Why: `runStep` (src/step.js) is done and tested but the CLI still prints "not yet implemented"; this makes the loop runnable and unblocks P1-6 (`hodge run`).

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
| P1-1b | Wire `hodge step` CLI (config file, adapter registry, JSON output) | todo | P1-1 |
| P1-2 | Repo gate (refuse target == hodgepodge) | done | P0-2 |
| P1-3 | Test-plan gate (plan exists, tests red first) | todo | P1-1 |
| P1-4 | Type gate, anti-stub gate, scope gate | todo | P1-1 |
| P1-5 | Budget gate (tokens/cost/time/iterations) | todo | P1-1 |
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
