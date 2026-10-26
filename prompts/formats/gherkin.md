Format: gherkin (`.feature` files, English keywords). Use it for executable examples instead of free-text `input -> output` lines.
- Declare under `## Formats` in the spec: `- gherkin: specs/features/<name>.feature`.
- The file must parse and hold at least one Scenario. Tag every Scenario with the requirement it proves, `@R-<spec>-<n>`, and give every Scenario a unique name (within and across files).
- Cover the failure paths as well as the happy path, one behaviour per Scenario, with concrete values in Given/When/Then.
- Confirm with `hodgepodge ready`.
