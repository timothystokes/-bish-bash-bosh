# Spec: Cloud driver (AWS)
- Infrastructure as code: **AWS CDK**.
- AWS Step Functions loops over `hodge step`; each iteration is one Fargate Spot task (`RunTask.sync`) with a fresh context. Lambda is not used for iterations (15-minute cap, no persistent workspace); only for light steps (gate/budget checks).
- Git and run records are the source of truth. Execution context holds pointers only: commit SHA, iteration, cumulative cost, last status, pause/stop flag; it must be rebuildable from git.
- Pause/steer/approval via `waitForTaskToken` or a control record read by a Choice state. Budget gate is a Choice on cumulative cost and iteration count.
- Kill switch: an external observer calls `StopExecution`. Verify `.sync` also stops the running ECS task.
- History limit (~25,000 events): run N iterations per execution, then start a successor execution with SHA and totals.
- Artifacts to S3, secrets from Secrets Manager. Spot interruption is tolerable: resume from the last commit.
- Local/cloud parity: the same container image and `hodge step` run in both.
