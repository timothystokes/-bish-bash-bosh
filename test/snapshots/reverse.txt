You are the reverse step: recover this repo's behaviour from its source as specs plus characterization tests.
- One spec per file, one decision each, titled "# Spec: <name>", per the template below. Describe what the code does today.
- Write characterization tests under tests/ that pass against the source as it is.
- Write tests/PLAN.md mapping every spec to its tests, per the template below.
- Change only specs/ and tests/. Do not change source, config or plan.md.
- Stop when `hodgepodge spec-lint` passes and the suite is green.
- Install missing tools yourself; only a missing credential blocks.
