# plan.md: working status

Update this file at the end of every session. Status: `todo` | `doing` | `done` | `blocked`.

## >>> Next best action
**P0-2: Config schema (JSON Schema): roles -> adapter + model, budgets, target repo, allowed paths (`specs/adapters.md`, `specs/repos.md`), with tests first.**
Why: P0-3 (adapter interface), P1-2 (repo gate) and everything downstream depend on the config shape.

## Phase 0: Foundations
| ID | Task | Status | Depends on |
|---|---|---|---|
| P0-1 | Scaffold repo + test/type-check wheel (`npm test`, `npm run check`) | done | |
| P0-2 | Config schema (JSON Schema): roles -> adapter + model, budgets, target repo, allowed paths | todo | P0-1 |
| P0-3 | Adapter interface + contract test suite (`specs/adapters.md`) | todo | P0-2 |
| P0-4 | Adapter: Copilot CLI (non-interactive) | todo | P0-3 |
| P0-5 | Adapter: Claude Code | todo | P0-3 |
| P0-6 | Adapter: Codex | todo | P0-3 |
| P0-7 | Adapter: generic OpenAI-compatible HTTP | todo | P0-3 |
| P0-8 | Run-record format + writer (`specs/loop.md`) | todo | P0-1 |

## Phase 1: Loop + gates
| ID | Task | Status | Depends on |
|---|---|---|---|
| P1-1 | `hodge step`: one idempotent iteration (stack allocation, agent call, scoped tests, commit, JSON status) | todo | P0-3, P0-8 |
| P1-2 | Repo gate (refuse target == hodgepodge) | todo | P0-2 |
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
