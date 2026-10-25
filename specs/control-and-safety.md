# Spec: Control, visibility, safety
- Autonomy: unattended or on-the-loop (visibility + controls). No per-step human gate.
- Terminal TUI first: live log tail, pause/resume/steer, kill switch, cost meter vs budget. No Slack. Web dashboard is not in v1.
- Control channel: `control.json` (pause, resume, steer note injected into next stack, stop), read between iterations. Format `{paused?: boolean, stop?: boolean, steer?: string}`; missing file = running, malformed file = stop (fail closed); a steer note applies to one iteration then is removed; stop wins over pause; the file lives outside the target repo. Kill switch terminates the container. CLI: `hodge control --file <f> pause|resume|stop|steer <note>` merges into the file atomically (refuses a malformed file); `hodge run --control <f>` enables it.
- Status-source abstraction (`src/status.js` `StatusSource`; `hodge status --config <f> [--repo] [--run-id] [--control <file>]` prints JSON iterations/tokens/cost/seconds vs budgets): run files locally; execution status/history and CloudWatch logs in AWS.
- Secret scanning: small Node preflight-style proxy between agent and model (regex credential rules, redact to `[REDACTED:rule-id]`, nothing forwarded half-inspected, audit log).
- Sandbox: Docker container per run locally; Fargate task in cloud.
- Audit log of tool calls.
