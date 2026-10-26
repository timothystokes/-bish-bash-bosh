# AGENTS.md

## What this repo is
Hodgepodge is a **model-agnostic harness for delivering software with loop-engineering (Ralph-style) patterns**. It contains the harness only. It never contains delivered work.

## Current focus
The main goal is the **Docker-based implementation** (local driver + per-run container). The AWS/scaled-out solution (`specs/cloud-driver.md`, plan Phase 5) is a **future goal, not the main goal for now**: do not pick Phase 5 tasks or add AWS requirements to Docker work until the owner promotes it.

## Read order (every session)
1. This file.
2. `plan.md`: working status and **"Next best action"**. Do that, unless the user says otherwise.
3. `specs/*.md`: one spec per decision. Read the ones relevant to the task.
4. `docs/PLAN.md`: background design and rationale.

## Rules
- One item per session/loop: pick the "Next best action", finish it, update `plan.md`, stop.
- Search the repo before assuming something is missing.
- Tests come first. A task is not done until its tests exist, failed first, and now pass. No stubs or partial implementations.
- Hodgepodge never hosts delivery work. Delivery happens in a separate target repo (see `specs/repos.md`).
- No model or vendor names in harness logic; they live in config only (see `specs/adapters.md`).
- Vanilla JavaScript with JSDoc, checked with `tsc --checkJs`; tests use `node:test`.
- Commit and push at the end of every session (see checklist). Outside that checklist, don't push unless the user says to. Include the Copilot co-author trailer in commits.
- Do not watch or poll CI after pushing.
- Keep `plan.md` truthful: update task status and the "Next best action" at the end of every session.
- Missing tools, packages, CLIs or dependencies are never a blocker: install them yourself (package manager, npx, pip, brew, apt, etc.) and continue; if one route fails, try another. The only valid blocker is a missing credential/secret you cannot obtain; state exactly which.
- When something goes wrong, tune the prompts/specs/gates ("add a sign"); don't just retry.
- No compatibility code: the harness is pre-release, so renames and removals are outright. No aliases, deprecation or pointer messages, no migration notes.
- Name the claim boundary: a task is "done" only with the tested scope stated (scripted adapter, live adapter, Docker). A passing structural check is not proof of runtime behaviour.
- Development-time only (does not change how the harness runs): after adding or changing implementation steps, do not run a full loop (hodge and podge end to end) to test. Run single steps in isolation if needed, and verify the rest by other means (unit tests, scripted adapter fixtures, structural/type checks, reading rendered prompts). State in the claim boundary that the full loop was not run. Run a full loop only if the user explicitly asks.
- Reconcile, don't rewrite: fix code that violates a spec, or change the spec deliberately with a stated rationale. Never edit a spec to match accidental behaviour.
- Never `git stash` (shared across sessions). To compare against a baseline, use a detached `git worktree`.
- Docs are part of done: a change that alters commands, config, prompts, templates or behaviour updates `README.md`, the affected `specs/*.md`, CLI help and the objective kit in the same session.

## End-of-session checklist (mandatory, every session)
1. Update task statuses in `plan.md`.
2. Rewrite the **">>> Next best action"** section in `plan.md`: the single most valuable next task, with a one-line "why", chosen from unblocked tasks (break down the next phase first if none remain).
3. Append a line to the "Session log" in `plan.md`: what was done, what was learned, any new "signs" added.
4. Update any `specs/*.md`, `README.md`, CLI help, templates or `AGENTS.md` rules that changed.
5. Evaluate if additional steps should be added to the checklist or plan, and assess which step is the next best action and mark it in `plan.md`.
6. Commit (with the co-author trailer) and push to `main`. Do not watch or poll CI afterwards.

## Out of scope for planning
Punk (a functional language) is a later validation project, to be run once a harness version exists. Do not plan around it.

## Owner preferences
- Owner: @timothystokes. Concise answers. Ask when requirements are ambiguous.
