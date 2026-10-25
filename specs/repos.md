# Spec: Repo separation
- Hodgepodge holds the harness only.
- Every delivery objective names a **target repo** in config. Specs, plan, tests, run records and code for that objective live in the target repo.
- Repo gate: the harness must refuse to run if the target repo is hodgepodge itself.
- Per-step commits go to a sandbox branch/repo of the target; humans review completed work before it leaves the sandbox.
- Promotion out of the sandbox is deferred (likely a traditional CD pipeline).
