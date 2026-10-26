# Spec: Spec formats (declared standards that constrain specs)
Status: planned, nothing implemented yet (plan.md "Spec formats", F-1..F-12).

- Purpose: free-form Markdown lets specs stay vague or contradict each other. A spec may declare that part of what it captures is expressed in an open standard format; the harness then validates that artifact and uses it as a gate wherever it bears on a step.
- Declaration: a spec lists adopted formats in a `## Formats` section, one bullet per artifact: `- <format>: <path>` (for example `- json-schema: specs/schemas/order.json`). Declaring a format is a strong signal that every requirement it covers is verified through that format.
- Tools live inside the harness (`package.json` dependencies) and validate the specs and their format artifacts. They are not used on, and need not support the language of, the delivered project. Where a declared format constrains a step's output (for example a JSON Schema for a file the loop produces), the harness runs the same embedded tool as a gate on that output.
- Readiness (`hodgepodge ready`) gains format checks: a declared artifact must exist, parse, pass its tool's validation, and be referenced by at least one requirement ID; a format-covered requirement without a conformance case is a gap.
- Consistency: artifacts are checked across specs, not only per file (unresolved or conflicting `$ref`s, duplicate operation IDs, clashing definitions).
- Requirement IDs: each requirement carries a stable ID (`<spec>-<n>`) used by `tests/PLAN.md`, test results and the `done.json` evidence report (H-21..H-23).

## Format set (first iteration)
| Format | Embedded tool | Role |
|---|---|---|
| JSON Schema 2020-12 | `ajv`, `ajv-formats`, `@hyperjump/json-schema` | data shapes, cross-file `$ref` consistency |
| OpenAPI 3.x | `@redocly/cli`, `@stoplight/spectral-cli`, `@apidevtools/swagger-parser` | HTTP APIs; lint and consistency |
| AsyncAPI | `@asyncapi/parser` | event and message contracts |
| Gherkin | `@cucumber/gherkin` | executable examples (replaces free-text `input -> output`) |
| EBNF | `ebnf` | input and output grammars |
| JUnit XML / TAP | `junit-report-merger`, `tap-parser` | map test results to requirement IDs |

Later (deferred): XState statecharts (`xstate`, `@xstate/graph`), property specs (`fast-check`), TypeSpec (`@typespec/compiler`), DBML (`@dbml/core`), Pact (`@pact-foundation/pact`), TLA+/Quint (`@informalsystems/quint`), WCAG (`axe-core`), SHACL, CDDL, GraphQL SDL, Protobuf.

## Requirements
- A declared format whose artifact is missing, unparseable or invalid must fail readiness with a gap naming the spec, format and path.
- An undeclared or unknown format name must fail readiness.
- A tool must run inside the harness without the target project installing anything.
- Cross-file conflicts between artifacts must fail readiness.

## Out of scope
- Validating the delivered project's own artifacts for languages the harness tools do not cover.
- Choosing formats for the owner: the interview proposes them, the owner confirms.
