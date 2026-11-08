# Implementation Plan: Bish-Bash-Bosh Harness

Goal: a harness for getting work done with loop-engineering patterns. Validation project (later, once a harness version exists): Punk, a functional language interpreted on Node. Punk is out of scope for harness planning.
Approach: Ralph-style loops (one task per loop, fresh context, fixed stack), strong back-pressure, files as state.

Current scope: direct local command-line execution only. Container images, container kill commands and cloud infrastructure scaffolding have been removed at the owner's request. This document preserves the original design rationale below; cloud execution remains deferred, not a requirement or an implemented feature. Current behaviour is defined in `../specs/`.

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
| Execution | Directly on the local host |
| Secrets | Small Node preflight-style proxy (regex rules, redact, audit) |
| UI | Terminal TUI first (log tail, pause/resume/steer, kill, cost meter vs budget). No Slack |
| State | Repo files only (in the target repo, never in bish-bash-bosh) |
| Repos | Bish-Bash-Bosh = harness only. Every delivery uses a separate target repo |
| Stack | Vanilla JS + JSDoc, `tsc --checkJs`, `node:test` |

## Repo layout (target)

```
bin/bish                 CLI entry
src/loop/                 iteration runner, stack allocator, stop conditions
src/adapters/             copilot.js claude.js codex.js openai-http.js (common interface)
src/gates/                test-plan, anti-stub, budget, scope gates
src/proxy/                preflight-style scanner/redactor + usage metering
src/tui/                  terminal UI + control channel
src/modes/                interview, reverse, forward, brownfield, harden, cleanroom
prompts/                  one loop prompt per mode (tuned "signs")
templates/                project template: specs/ plan/ tests/ runs/
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
   - Repo gate: refuse to run if the target repo is the bish-bash-bosh repo itself.
   - Fast-wheel rule: scoped tests per iteration; full suite on a schedule.
5. **Control channel:** `control.json` remains available to the status/TUI tooling. The current Plan and Build Loops do not consume it; interrupt local commands with Ctrl-C.
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
- Direct local execution.
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

Delivery work always happens in a separate target repo, never in the bish-bash-bosh (harness) repo. Bish-Bash-Bosh only holds the harness; each objective points at its own target repo (with its own sandbox branch/repo for per-step commits).
