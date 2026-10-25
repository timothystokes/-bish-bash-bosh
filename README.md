# ticked-hodgepodge

Model-agnostic agentic software delivery harness (loop engineering, Ralph-style).

**Starting a session? Read `AGENTS.md`, then `plan.md` (it names the next best action), then `specs/`.** Background design is in `docs/PLAN.md`. This repo holds the harness only; delivery work always lives in a separate target repo.

## Original requirements (draft)
## Goal
Deliver software both forward (specs → code) and in reverse (code → specs).

## v1 modes
- Spec-capture interview
- Reverse: code → specs
- Forward: specs → code
- Brownfield change loops
- Test-hardening loops
- Clean-room rebuild

## Core design
- Ralph-style Bash/Node loop around CLI agents: one task per loop, fresh context, fixed stack (`specs/*`, plan file, loop prompt).
- Thin agent/model adapter; models and agents swap via config only (Copilot CLI, Claude Code, Codex).
- State lives in repo files (`specs/`, plan, logs, run records).
- Vanilla JavaScript with JSDoc + `tsc --checkJs` as type back-pressure.
- Tests are a gate: each delivery objective defines its tests before a loop may start.
- Sub-agents: parallel for search/writes, serial for build/test.
- Anti-stub rules: search before implementing; reject stubs and partial implementations.

## Operating on the loop
Live log tail, web dashboard, pause/resume/steer, kill switch, cost meter against per-run budgets. No human-in-the-loop-per-step mode; no Slack.

## Safety
- Secret scanning on model traffic
- Sandboxed/isolated execution
- Budget/token caps per run
- Human approval before merge/deploy
- Audit log of tool calls

## Deliverables
Repo template (prompts, scripts, docs) and an installable CLI.

## Execution targets
Local (Docker) is the main goal for now; scaling to AWS is a future goal (proposed: ECS Fargate per run, S3 artifacts, Secrets Manager, Step Functions for pause/approval, CloudWatch for dashboard/cost).
