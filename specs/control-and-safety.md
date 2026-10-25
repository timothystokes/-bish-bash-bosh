# Spec: Control, visibility, safety
- Autonomy: unattended or on-the-loop (visibility + controls). No per-step human gate.
- Terminal TUI first: live log tail, pause/resume/steer, kill switch, cost meter vs budget. No Slack. Web dashboard is not in v1.
- Control channel: `control.json` (pause, resume, steer note injected into next stack, stop), read between iterations. Kill switch terminates the container.
- Status-source abstraction: run files locally; execution status/history and CloudWatch logs in AWS.
- Secret scanning: small Node preflight-style proxy between agent and model (regex credential rules, redact to `[REDACTED:rule-id]`, nothing forwarded half-inspected, audit log).
- Sandbox: Docker container per run locally; Fargate task in cloud.
- Audit log of tool calls.
