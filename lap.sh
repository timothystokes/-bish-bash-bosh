#!/usr/bin/env bash
set -euo pipefail

PROMPT='Run exactly one session of this repo, following AGENTS.md strictly.

1. Read AGENTS.md, then plan.md (status and ">>> Next best action"), then only the specs/*.md relevant to that task. Search the repo before assuming anything is missing.
2. Do the "Next best action" and nothing else. Never pick Phase 5 (AWS) tasks or tasks marked `implement later`. If it is too big for one session, do the largest complete slice and break the rest down in plan.md.
3. Tests first: write them, run them and see them fail, then implement until they pass. No stubs or partial implementations. Run the repo type check (tsc --checkJs) and the relevant tests; do not run a full bish/bosh loop.
4. Reconcile, do not rewrite: fix code that violates a spec, or change the spec deliberately with a stated rationale. No compatibility code. No model or vendor names in harness logic.
5. Missing tools or dependencies are never a blocker: install them. Only a missing credential you cannot obtain is a blocker; name it exactly.
6. State the claim boundary for what you finished (scripted adapter or live adapter; full loop not run). A passing structural check is not proof of runtime behaviour.
7. Update docs affected by the change (README.md, specs, CLI help, templates, objective kit).
8. Complete the end-of-session checklist in AGENTS.md: update plan.md task statuses, rewrite ">>> Next best action" with a one-line why, append a Session log line (what was done, learned, new signs), then commit with the Copilot co-author trailer and push to main. Never git stash. Do not watch or poll CI.
9. Then stop and exit. Do not start a second task.'

copilot --mode autopilot --allow-all-tools --allow-all --yolo -p "$PROMPT"
