# Instructional file sizes: ghuntley `ralph-to-ralph-prod` vs hodgepodge (O-2)

Measured 2026-10-28 with `wc -lc` (bytes, lines) on the local clone `/Users/tim/work/ghuntley/ralph-to-ralph-prod` and this repo. File list comes from O-1 (`docs/ghuntley-prompt-comparison.md`) and the `@`-attachments in his `*-ralph.sh` scripts. Prompts are compared by content in O-1, not here.

## 1. Loop prompts

| ghuntley | Lines | Bytes | hodgepodge | Lines | Bytes |
|---|---|---|---|---|---|
| `inspect-prompt.md` | 92 | 5282 | `prompts/interview.md` | 8 | 878 |
| | | | `prompts/reverse.md` | 7 | 604 |
| | | | `prompts/brownfield.md` | 6 | 649 |
| | | | `prompts/clean-room.md` | 5 | 716 |
| `build-prompt.md` | 93 | 5209 | `prompts/forward.md` | 6 | 627 |
| | | | `prompts/plan.md` | 8 | 717 |
| `qa-prompt.md` | 90 | 4223 | `prompts/qa.md` | 5 | 992 |
| | | | `prompts/test-hardening.md` | 7 | 883 |
| **Total** | **275** | **14714** | **Total (8 prompts)** | **52** | **6066** |
| | | | `prompts/formats/*` (5, loaded per format) | 26 | 2922 |

Like for like (build / QA / inspect-or-interview): his 14714 B vs our 2497 B (forward + qa + interview), about 6x. Our other modes are extra.

## 2. Standing instruction and spec files

| ghuntley | Lines | Bytes | hodgepodge | Lines | Bytes |
|---|---|---|---|---|---|
| `CLAUDE.md` | 67 | 2956 | `AGENTS.md` | 31 | 2770 |
| `AGENTS.md` (QA guide) | 80 | 3393 | | | |
| `pre-setup.md` | 67 | 3371 | | | |
| `README.md` | 138 | 5422 | `README.md` | 109 | 8711 |
| `build-spec.md` | 1221 | 57491 | `specs/*.md` (8 files, read on demand) | 133 | 37744 |
| `inspect-spec.md` | 294 | 12517 | | | |
| `sitemap.md` | 99 | 4131 | | | |
| `ever-cli-reference.md` | 312 | 13878 | | | |

Our specs: `adapters` 1923, `cloud-driver` 3397, `control-and-safety` 2878, `formats` 7600, `gates` 3749, `loop` 8358, `modes` 9346, `repos` 493 B.

## 3. Objective kit / templates (ours only)

| File | Lines | Bytes |
|---|---|---|
| `templates/objective/INTERVIEW.md` | 14 | 1786 |
| `templates/objective/READINESS.md` | 19 | 1682 |
| `templates/objective/PHASES.md` | 10 | 1178 |
| `templates/objective/OPEN-QUESTIONS.md` | 4 | 175 |
| `templates/objective/BRIEF.md` | 3 | 138 |
| `templates/objective/plan.md` | 3 | 134 |
| `templates/objective/CONVERSATION.md` | 3 | 99 |
| **Kit total** | **56** | **5192** |
| `templates/spec.md` | 30 | 1392 |
| `templates/tests-PLAN.md` | 9 | 359 |

## 4. Loop scripts

| ghuntley | Lines | Bytes | hodgepodge | Lines | Bytes |
|---|---|---|---|---|---|
| `build-ralph.sh` | 74 | 2272 | `loop.sh` | 3 | 31 |
| `inspect-ralph.sh` | 65 | 1831 | `lap.sh` | 16 | 1753 |
| `qa-ralph.sh` | 102 | 2988 | | | |
| `ralph-to-ralph.sh` | 52 | 1341 | | | |
| `ralph-watchdog.sh` | 152 | 4067 | | | |
| **Total** | **445** | **12499** | **Total** | **19** | **1784** |

Our orchestration is in `src/` (not instructional text, so not counted).

## 5. Context attached per iteration

His scripts `@`-attach whole files on every invocation. Ours injects the prompt plus one `plan.md` item plus spec pointers (`src/podge-next-item.js`); the agent reads `AGENTS.md` and only the specs it needs.

| Iteration | Files attached | Bytes |
|---|---|---|
| ghuntley build | `build-prompt.md` 5209 + `pre-setup.md` 3371 + `build-spec.md` 57491 + `prd.json` 126987 + `build-progress.txt` 69236 + `CLAUDE.md` 2956 | **265250** |
| ghuntley QA | `qa-prompt.md` 4223 + `pre-setup.md` 3371 + `build-spec.md` 57491 + `prd.json` 126987 + `qa-progress.txt` 2264 + `qa-report.json` 10197 + `ever-cli-reference.md` 13878 | **218411** |
| ghuntley inspect | `inspect-prompt.md` 5282 + `inspect-spec.md` 12517 + `ever-cli-reference.md` 13878 + `prd.json` 126987 + `inspect-progress.txt` 31509 (+ any further attachments past line 33 of the script, not counted) | **>= 190173** |
| hodgepodge forward | `prompts/forward.md` 627 + one plan item + spec pointers (word budget enforced in `test/next-item.test.js`) | **under 1 KB injected**; agent then reads `AGENTS.md` 2770 and the specs it needs (<= 37744 if it read them all) |

## 6. Findings

1. Prompt text: ours is about 6x smaller (6066 B vs 14714 B in total; 2497 B vs 14714 B like for like).
2. The big difference is attached state, not prompts: his per-iteration context is 190-265 KB because `prd.json` (127 KB), `build-progress.txt` (69 KB) and `build-spec.md` (57 KB) are attached whole and grow. Ours is harness-selected, under 1 KB injected.
3. Our largest standing files are `README.md` (8.7 KB) and `specs/modes.md` + `specs/loop.md` (17.7 KB); they are read on demand, not injected. Hodgepodge's own `plan.md` (115 KB) is the same growth pattern as his `prd.json`/progress files, but it is never loop context.
4. Our scripts are 7x smaller in bytes (1784 B vs 12499 B) because stop, retry and watchdog logic lives in `src/` and gates.

Claim boundary: read-only measurement of file sizes; no code changed, no loop run. Our per-iteration injected size is from the budget test, not a measured live run.
