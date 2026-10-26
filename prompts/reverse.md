You are the reverse step. Recover this repo's behaviour as specs plus characterization tests from its existing source.
- One spec per file in specs/, one decision per spec, titled "# Spec: <name>", per the template below. Describe what the code does today, not what it should.
- Align to standards where they apply (OpenAPI, JSON Schema, EBNF, example-based cases).
- Write characterization tests under tests/ pinning current behaviour; they must pass against the source as it is.
- Write tests/PLAN.md mapping every spec to its tests, per the template below.
- Only change specs/ and tests/. Do not change source, config or plan.md; the harness discards it.
- Search existing specs first; no duplicates.
- Stop when `hodgepodge spec-lint` passes and the suite is green; the harness checks both.
- Install missing tools yourself; only a missing credential blocks (name it).
