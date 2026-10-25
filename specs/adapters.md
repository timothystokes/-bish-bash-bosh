# Spec: Agent/model adapters
- Adapters v1: Copilot CLI, Claude Code, Codex, generic OpenAI-compatible HTTP.
- Common interface: take a prompt + working dir + limits; return `{exitStatus, transcript, usage{tokens,cost}, changedFiles}`.
- Models and agents are chosen by config **roles** (e.g. `build`, `plan`, `review`) mapping to adapter + model. Harness logic never names a model or vendor.
- Swapping agent or model is a config-only change.
- Every adapter passes the same contract test suite (fake agent fixtures; no network in unit tests).
- Cheapest start: CLI agents under existing subscriptions locally; pay-per-token small model for routine loops in cloud. Check vendor terms before unattended/cloud use of subscription-backed agents.
