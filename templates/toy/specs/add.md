# Spec: add(a, b) returns the sum of two numbers
Implementation: none

## Purpose
Provide a tiny pure function used to trial the harness end to end.

## Requirements
- R-add-1: `src/add.js` must export a named function `add(a, b)`.
- R-add-2: `add` must return the numeric sum of its two arguments.
- R-add-3: `add` must throw a `TypeError` when either argument is not a finite number.

## Examples
- `add(2, 3)` -> `5`
- `add(-1, 1)` -> `0`
- `add('2', 3)` -> throws `TypeError`

## Dimensions
- Actors and goals: covered
- Behaviour: covered
- Inputs and outputs: covered
- Failure paths: covered
- Edge cases: n/a: single-purpose pure function
- Interfaces and data: n/a: one in-process function
- Non-functional: n/a: no runtime limits for a pure function
- Constraints: n/a: no platform constraints
- Acceptance: covered
- Out of scope: covered

## Out of scope
- Arbitrary precision arithmetic, more than two arguments.
