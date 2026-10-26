# Spec: <name of the one decision this file records>
Implementation: none

## Purpose
One or two sentences: what this decides and why it exists.

## Requirements
- R-example-1: Each requirement has a stable ID `R-<spec file name>-<n>` and is a single, testable statement ("must ...").

## Examples
- Input -> expected output. Prefer concrete, executable cases (conformance examples).

## Formats
Optional: one bullet per artifact in an adopted standard format: `- <format>: <path>` (for example `- json-schema: specs/schemas/order.json`); add `-> <output path>` for a file the loop produces that must conform (`- json-schema: specs/schemas/order.json -> out/order.json`). Delete this section when unused; a requirement must reference each declared path.

## Dimensions
One bullet per interview dimension, each `covered` or `n/a: <reason>` (all ten are required): Actors and goals, Behaviour, Inputs and outputs, Failure paths, Edge cases, Interfaces and data, Non-functional, Constraints, Acceptance, Out of scope.
- Actors and goals: covered
- Behaviour: covered
- Inputs and outputs: covered
- Failure paths: covered
- Edge cases: n/a: one-line reason it does not apply
- Interfaces and data: covered
- Non-functional: n/a: one-line reason it does not apply
- Constraints: covered
- Acceptance: covered
- Out of scope: covered

## Out of scope
- What this spec deliberately does not cover.
