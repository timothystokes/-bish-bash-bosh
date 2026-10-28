# Spec: Repo model
- Hodgepodge holds the harness only. It never holds delivered work.
- Every command operates directly on the current working directory: the project being built. There is no separate sandbox dir and no `--dir` flag; `hodgepodge.yml` (config: roles, budgets, allowedPaths) lives at the project root, alongside the project's own files.
- Repo gate: the harness must refuse to run if the project directory is hodgepodge's own checkout (the harness never builds itself by accident).
- Per-step commits go to the project's own branch; humans review completed work (`hodgepodge promote` opens a PR, never merges) before it is promoted further.
- Promotion beyond that PR review is deferred (likely a traditional CD pipeline).
- Local driver: one run is one Docker container, with the project directory bind-mounted as the container's working directory (`specs/loop.md`). The cloud driver (`specs/cloud-driver.md`) is a future goal with the same container image and `podge step` contract.

