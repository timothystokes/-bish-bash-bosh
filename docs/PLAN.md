# Implementation Plan: Hodgepodge Harness

Goal: a harness for getting work done with loop-engineering patterns. Validation project (later, once a harness version exists): Punk, a functional language interpreted on Node. Punk is out of scope for harness planning.
Approach: Ralph-style loops (one task per loop, fresh context, fixed stack), strong back-pressure, files as state.

## Decisions captured

| Area | Decision |
|---|---|
| Runner | Node loop around CLI agents; one task per iteration; fresh context |
| Adapters v1 | Copilot CLI, Claude Code, Codex, generic OpenAI-compatible HTTP |
| Models | Fully abstracted via config mapping roles to adapter+model; no model names in code |
| Autonomy | Unattended or on-the-loop (visibility + controls). No per-step human gate |
| Gate | Per-step commits to a **sandbox repo/branch**; human reviews completed work before promotion out of sandbox |
| Tests | Test plan required per objective; must exist and be red before build loops start |
| Reverse specs | Specs constrained by standards: OpenAPI, JSON Schema, example-based conformance cases |
| Sandbox | Docker locally; Fargate task in cloud |
| Secrets | Small Node preflight-style proxy (regex rules, redact, audit) |
| UI | Terminal TUI first (log tail, pause/resume/steer, kill, cost meter vs budget). No Slack |
| State | Repo files only (in the target repo, never in hodgepodge) |
| Repos | Hodgepodge = harness only. Every delivery uses a separate target repo |
| Stack | Vanilla JS + JSDoc, `tsc --checkJs`, `node:test` |

## Repo layout (target)

```
bin/hodge                 CLI entry
src/loop/                 iteration runner, stack allocator, stop conditions
src/adapters/             copilot.js claude.js codex.js openai-http.js (common interface)
src/gates/                test-plan, anti-stub, budget, scope gates
src/proxy/                preflight-style scanner/redactor + usage metering
src/tui/                  terminal UI + control channel
src/modes/                interview, reverse, forward, brownfield, harden, cleanroom
prompts/                  one loop prompt per mode (tuned "signs")
templates/                project template: specs/ plan/ tests/ runs/
infra/                    Dockerfile, compose, AWS CDK app
docs/
```

Run record per objective: `runs/<id>/{plan.md, iterations/NNN/{prompt,transcript,diff,test.json,usage.json}, control.json}`.

## Core mechanics

1. **Stack allocation (every loop, deterministic):** loop prompt + `specs/**` index + `plan.md`. Nothing else carries between iterations.
2. **One item per loop:** agent picks the most important item from `plan.md`, searches before assuming it is missing, implements, runs scoped tests, updates the plan, commits.
3. **Subagent policy in prompt:** parallel for search/read/write, exactly one for build/test.
4. **Back-pressure gates (harness-enforced, not just prompted):**
   - Test-plan gate: `tests/PLAN.md` maps each spec to tests; tests must fail first.
   - Type gate: `tsc --checkJs`.
   - Anti-stub gate: reject TODO/stub/"not implemented"/empty bodies in the diff.
   - Scope gate: changes confined to the objective's allowed paths.
   - Budget gate: tokens/cost/wall-clock/iteration caps.
   - Repo gate: refuse to run if the target repo is the hodgepodge repo itself.
   - Fast-wheel rule: scoped tests per iteration; full suite on a schedule.
5. **Control channel:** `control.json` (pause, resume, steer note injected into the next stack, stop). TUI writes it; the runner reads it between iterations; the kill switch terminates the container.
6. **Tune-the-guitar loop:** failure patterns seen in transcripts become signs in prompts or rules in `specs/stdlib`. Tests record *why* they exist.

## Modes

| Mode | Input to output | Notes |
|---|---|---|
| Interview | Conversation to `specs/*.md` (one per file) | Emits JSON Schema/OpenAPI where applicable |
| Forward | specs to code + tests | Core Ralph loop |
| Reverse | code (and running system) to specs + characterization tests | Standards-aligned output |
| Brownfield | spec delta to change | Reverse first if specs are missing |
| Test-hardening | existing code to stronger tests | Mutation/property tests; coverage as gate |
| Clean-room | spec bundle only to rebuild | Context firewall: builder never sees source |

## Phases

**Phase 0: Foundations**
- Repo scaffolding, config schema, adapter interface, run-record format.
- Adapters: Copilot CLI and Claude Code first (non-interactive modes), then Codex, then OpenAI-HTTP.
- Exit: the same prompt runs through any adapter by changing config only.

**Phase 1: Loop + gates**
- Loop runner, stack allocator, per-iteration commit to the sandbox branch, test-plan/type/anti-stub/budget gates.
- Docker image + local run.
- Exit: a toy objective completes unattended with red-to-green tests.

**Phase 2: Spec modes**
- Interview and forward modes, spec-lint, spec/test-plan templates.
- Exit: a small throwaway objective goes interview -> specs -> test plan -> forward loops -> green; failures feed prompt tuning.

**Phase 3: Control + visibility**
- TUI, control channel, usage metering via proxy, cost meter against budget.
- Secret-scanning proxy with audit log.

**Phase 4: Reverse, brownfield, harden, clean-room**
- Validate the round trip on a small project: code -> specs -> clean-room rebuild -> conformance suite passes.
- After a harness version exists, run Punk as the first real test.

**Phase 5: Cloud (future goal; Docker/local is the main goal for now)**
- Image to ECR, Step Functions driver with Fargate Spot iterations, artifacts to S3, secrets from Secrets Manager, promotion review via PR.

## Cloud cost and the Lambda question

- **Lambda** matches Ralph's "fresh context each iteration" shape, but has a hard 15-minute cap per invocation, no persistent workspace (clone every time), and is awkward for long builds and test runs. One agent iteration plus tests can approach or exceed the cap. Chaining iterations needs an external orchestrator (Step Functions), adding cost and complexity.
- **Cheapest practical option: Fargate Spot**, one task per run. Billed per second, no duration cap, same container as local. Interruptions are tolerable because every iteration is committed, so a run resumes from the last commit.
- **Recommendation:** local Docker first (no infra cost); cloud via Fargate Spot. Revisit Lambda only if iterations are reliably under ~5 minutes.

## Cloud loop driver: Step Functions (decided)

- `podge step` is the single iteration unit: idempotent, reads git, runs one loop, commits, emits a small JSON status `{sha, iteration, cost, status}`. Designed in Phases 0-1.
- Two thin drivers call it: a local Node `while` loop, and an AWS Step Functions state machine (Fargate `RunTask.sync` per iteration, fresh context each time).
- Git and run records are the source of truth. Execution context holds pointers only (commit SHA, iteration, cumulative cost, last status, pause/stop flag) and must be rebuildable from git.
- Pause/steer/approval via `waitForTaskToken` or a control record read by a Choice state; budget gate is a Choice on cumulative cost and iteration count.
- Kill switch: observer calls `StopExecution`. Verify that `.sync` also stops the running ECS task.
- History limit (~25,000 events): run N iterations per execution, then start a successor execution (continue-as-new) with SHA and totals.
- Lambda only for light steps (test-plan gate check, budget check); iterations stay on Fargate Spot.
- TUI uses a status-source abstraction: run files locally, `DescribeExecution`/history/CloudWatch in AWS.

## Cheapest model path to start

- Locally: use the CLI agents under existing subscriptions (Copilot CLI / Claude Code), so there is no per-token bill. Check vendor terms before running subscription-backed agents unattended or in the cloud.
- Cloud or HTTP adapter: pay-per-token API, with a small cheap model for routine loops and a stronger one for planning and review (role-based config makes this a one-line change).
- Budget caps are enforced from day one so a runaway loop cannot surprise you.

## Reverse engineering and standards

- Specs are markdown plus machine-readable contracts: JSON Schema for data, OpenAPI for HTTP surfaces, and, for language-like targets, example-based conformance cases (input, expected output) as JSON.
- Characterization tests are generated from the running system, so specs are verified rather than just written.

## Risks and mitigations

- Wrong specs produce wrong builds: add a spec-lint step (duplicate or contradictory definitions) before forward loops.
- Non-deterministic search causes duplicate implementations: "search first" sign plus a duplicate-symbol gate.
- Context rot: strict one-item-per-loop and a small stack.
- Agent CLI churn: the adapter interface isolates changes; add contract tests per adapter.
- Cost runaway: budget gate plus proxy-side metering.

## Still open

1. Promotion out of the sandbox: deferred. Expected to align with a traditional CD pipeline from sandbox forward.

Decided: AWS infrastructure uses CDK. Delivery work always happens in a separate target repo, never in the hodgepodge (harness) repo. Hodgepodge only holds the harness; each objective points at its own target repo (with its own sandbox branch/repo for per-step commits).
