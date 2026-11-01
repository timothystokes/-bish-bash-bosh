# Spec: Repo model
- Hodgepodge holds the harness only. It never holds delivered work.
- Every command operates directly on the current working directory: the project being built. There is no separate sandbox dir and no `--dir` flag; `.hodgepodge/config.yml` (config: adapter, model) lives under the project's `.hodgepodge/` directory, alongside the project's own files.
- Repo gate: the harness must refuse to run if the project directory is hodgepodge's own checkout (the harness never builds itself by accident).
- Per-step commits go to the project's own branch; humans review completed work (`hodgepodge promote` opens a PR, never merges) before it is promoted further. This applies to `hodge --reverse` and the legacy agent-driven interview conversation, the only loops that still touch git directly. `hodge`'s Interview Loop, `gepo`'s Plan Loop and `podge`'s Build Loop commit nothing themselves: each only writes `.hodgepodge/*.md`/project files directly to disk, leaving commits to the owner.
- Promotion beyond that PR review is deferred (likely a traditional CD pipeline).
- Local driver: one run is one Docker container, with the project directory bind-mounted as the container's working directory (`specs/loop.md`). The cloud driver (`specs/cloud-driver.md`) is a future goal with the same container image and `podge` contract.

