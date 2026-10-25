# AGENTS.md

## What this repo is
Hodgepodge is a **model-agnostic harness for delivering software with loop-engineering (Ralph-style) patterns**. It contains the harness only. It never contains delivered work.

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
- When something goes wrong, tune the prompts/specs/gates ("add a sign"); don't just retry.

## End-of-session checklist (mandatory, every session)
1. Update task statuses in `plan.md`.
2. Rewrite the **">>> Next best action"** section in `plan.md`: the single most valuable next task, with a one-line "why", chosen from unblocked tasks (break down the next phase first if none remain).
3. Append a line to the "Session log" in `plan.md`: what was done, what was learned, any new "signs" added.
4. Update any `specs/*.md` or `AGENTS.md` rules that changed.
5. Commit (with the co-author trailer) and push to `main`. Do not watch or poll CI afterwards.

## Out of scope for planning
Punk (a functional language) is a later validation project, to be run once a harness version exists. Do not plan around it.

## Owner preferences
- Owner: @timothystokes. Concise answers. Ask when requirements are ambiguous.
