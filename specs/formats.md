# Spec: Spec formats (declared standards that constrain specs)
Status: partly implemented (X-3: declaration parsing, registry, readiness gaps; X-8: `json-schema` on `ajv` (2020-12 + `ajv-formats`) with meta-schema validation, cross-file `$id`/`$ref` consistency, output conformance and the `formats` loop gate; X-9: `openapi` on `@seriousme/openapi-schema-validator` schemas + `ajv`, `asyncapi` on `@asyncapi/specs` + `ajv`, `gherkin` on `@cucumber/gherkin`; `ebnf` on `ebnf` (W3C notation); `@hyperjump/json-schema` is not used). plan.md "Spec formats", F-1..F-12.

- Purpose: free-form Markdown lets specs stay vague or contradict each other. A spec may declare that part of what it captures is expressed in an open standard format; the harness then validates that artifact and uses it as a gate wherever it bears on a step.
- Declaration: a spec lists adopted formats in a `## Formats` section, one bullet per artifact: `- <format>: <path>` (for example `- json-schema: specs/schemas/order.json`). Declaring a format is a strong signal that every requirement it covers is verified through that format.
- Tools live inside the harness (`package.json` dependencies) and validate the specs and their format artifacts. They are not used on, and need not support the language of, the delivered project. Where a declared format constrains a step's output (for example a JSON Schema for a file the loop produces), the harness runs the same embedded tool as a gate on that output.
- Output declaration: a bullet may add `-> <output path>` (`- json-schema: specs/schemas/order.json -> out/order.json`): a repo-relative file the loop produces that must conform to the artifact. A missing output is skipped (not yet produced); an existing one that is not valid JSON or violates the schema is a gap.
- Registry: `src/formats.js` `FORMATS` maps `name -> {validate(path), crossCheck(paths), conform?(schema, data, schemaPaths)}`; `checkFormats` runs it and `checkReadiness` includes its gaps. `json-schema`: `validate` checks the artifact against the meta-schema; `crossCheck` loads all declared schemas into one `ajv` instance (duplicate `$id` and unresolved `$ref` are problems); `conform` validates an output against a schema.
- Loop gate (F-11): `runStep` runs `checkFormatGate` (the same `checkFormats` gaps) after the scope and anti-stub gates when any spec declares a format; a gap fails the step (`formats` in `record.json` gates, detail lists the gaps) and the work is reverted.
- Readiness (`hodgepodge ready`) gains format checks: a declared artifact must exist, parse, pass its tool's validation, and be referenced by at least one requirement ID; a format-covered requirement without a conformance case is a gap.
- Consistency: artifacts are checked across specs, not only per file (unresolved or conflicting `$ref`s, duplicate operation IDs, clashing definitions).
- Requirement IDs: each requirement carries a stable ID (`R-<spec>-<n>`, enforced by spec-lint) used by `tests/PLAN.md`, test results and the `done.json` evidence report (H-21..H-23).

## Format set (first iteration)
| Format | Embedded tool | Role |
|---|---|---|
| JSON Schema 2020-12 | `ajv`, `ajv-formats`, `@hyperjump/json-schema` | data shapes, cross-file `$ref` consistency |
| OpenAPI 3.0/3.1/3.2 (JSON or YAML) | `@seriousme/openapi-schema-validator` (official schemas, run through `ajv`/`ajv-draft-04`), `yaml` | HTTP APIs; `validate` checks the document against the official schema for its `openapi` version, unresolved local `#/...` `$ref`s and duplicate `operationId`; `crossCheck` flags an `operationId` defined in two documents. No `-> output` conformance; Redocly/Spectral linting is not used (async CLIs, rulesets) |
| AsyncAPI 2.x/3.x (JSON or YAML) | `@asyncapi/specs` (official schemas, run through `ajv`; `@asyncapi/parser` is async so is not used), `yaml` | event and message contracts; `validate` checks the document against the official schema for its `asyncapi` version, unresolved local `#/...` `$ref`s and duplicate operation ids (2.x `operationId`; 3.x operation keys); `crossCheck` flags an operation id defined in two documents. No `-> output` conformance |
| Gherkin (`.feature`) | `@cucumber/gherkin` (classic English parser, synchronous) | executable examples (replaces free-text `input -> output`); `validate` parses the file, requires at least one Scenario/Scenario Outline, requires every scenario to carry a requirement ID tag `@R-<spec>-<n>` (on the scenario, its Rule or the Feature) and flags a scenario name repeated within the file; `crossCheck` flags a scenario name used in two files. No `-> output` conformance; step definitions are not checked |
| EBNF (W3C notation) | `ebnf` | input and output grammars; `validate` parses the grammar (undefined rule references fail), then runs the examples declared as comments `/* accept: "<JSON string>" */` and `/* reject: "<JSON string>" */` against the first rule (an accept must match the whole input, a reject must not); at least one accept and one reject example are required and a malformed example comment is a gap. `crossCheck` has nothing to flag. No `-> output` conformance; an example cannot contain `*/` |
| JUnit XML / TAP | `junit-report-merger`, `tap-parser` | map test results to requirement IDs |

Later (deferred): XState statecharts (`xstate`, `@xstate/graph`), property specs (`fast-check`), TypeSpec (`@typespec/compiler`), DBML (`@dbml/core`), Pact (`@pact-foundation/pact`), TLA+/Quint (`@informalsystems/quint`), WCAG (`axe-core`), SHACL, CDDL, GraphQL SDL, Protobuf.

## Requirements
- A declared format whose artifact is missing, unparseable or invalid must fail readiness with a gap naming the spec, format and path.
- An undeclared or unknown format name must fail readiness.
- A tool must run inside the harness without the target project installing anything.
- Cross-file conflicts between artifacts (duplicate `$id`, unresolved `$ref`) must fail readiness.
- An OpenAPI artifact that violates its official schema, has an unresolved local `$ref`, or repeats an `operationId` (within or across documents) must fail readiness.
- An AsyncAPI artifact that violates its official schema, has an unresolved local `$ref`, or repeats an operation id (within or across documents) must fail readiness.
- A Gherkin artifact that fails to parse, has no scenarios, has a scenario without a requirement ID tag, or reuses a scenario name (within or across files) must fail readiness.
- An EBNF artifact that does not parse, references an undefined rule, has no accept or no reject example, has a malformed example comment, or has an example the grammar treats differently from its declaration must fail readiness.
- A declared output that violates its schema must fail readiness and the `formats` loop gate.

## Out of scope
- Validating the delivered project's own artifacts for languages the harness tools do not cover.
- Choosing formats for the owner: the interview proposes them, the owner confirms (`templates/objective/INTERVIEW.md` "Proposing formats"; F-10).
