# AGENTS.md

Bish-Bash-Bosh is a model-agnostic harness for loop-engineering (Ralph-style) delivery. It holds the harness only, never delivered work (see `specs/repos.md`).

**Focus:** local command-line execution in the current project. Docker/container support has been removed. AWS (`specs/cloud-driver.md`, plan Phase 5) is a future goal: don't pick it or add infrastructure until the owner promotes it. Punk is a later validation project: don't plan around it.

**Read:** this file, then `plan.md` ">>> Next best action" (do that unless told otherwise), then only the `specs/*.md` the task needs. `docs/PLAN.md` is background.

## Rules
- One item per session: do it, update `plan.md`, stop. Search the repo before assuming something is missing.
- Tests first: they must exist, fail, then pass. No stubs or partial implementations.
- Vanilla JS, no JSDoc; `tsc --checkJs` is a lint-only check (`strict:false`). Tests use `node:test`. No model or vendor names in harness logic (config only, `specs/adapters.md`).
- Keep per-loop context small: loops get one plan item plus spec pointers, never whole files. Shrink prompts, don't grow them. (No test currently enforces a byte budget on this — `test/next-item.test.js` did, for the old build loop, and was removed with it; a future request could add an equivalent check for `bash`/`bosh`'s prompts.)
- Missing tools or packages are never a blocker: install them. Only a missing credential is, and say which. `implement later` tasks in `plan.md` are deferred: never pick them or check for their CLIs/keys.
- On failure tune prompts/specs/gates ("add a sign"); don't just retry.
- Pre-release: no compatibility code, aliases, deprecation notes or migrations.
- State the claim boundary for "done" (scripted adapter or live adapter). A structural check is not proof of runtime behaviour.
- Don't run a full loop (bish and bosh end to end) to test; run single steps, unit tests, scripted fixtures, type checks, or read rendered prompts. Say the full loop was not run. Run one only if the user asks.
- Reconcile, don't rewrite: fix code that violates a spec, or change the spec with a stated rationale. Never edit a spec to match accidental behaviour.
- Never `git stash`; compare baselines with a detached `git worktree`.
- Docs are part of done: changes to commands, config, prompts, templates or behaviour update `README.md`, the affected `specs/*.md`, CLI help and the objective kit.
- Push only at the end-of-session checklist, or when told. Never watch or poll CI. Commits carry the Copilot co-author trailer.

## End of every session
1. Update task statuses in `plan.md`.
2. Rewrite ">>> Next best action": one unblocked task with a one-line why (break down the next phase if none).
3. Append to the "Session log": what was done, learned, new signs.
4. Update changed `specs/`, `README.md`, CLI help, templates, `AGENTS.md`.
5. Commit and push to `main`.

Owner: @timothystokes. Concise answers; ask when requirements are ambiguous.
