Format: json-schema (JSON Schema 2020-12). Use it for data shapes: payloads, config files, records.
- Declare under `## Formats` in the spec: `- json-schema: specs/schemas/<name>.json`. Add `-> <output path>` to name a loop output that must conform (`- json-schema: specs/schemas/order.json -> out/order.json`).
- Write a valid 2020-12 document with a unique `$id`; reference other schemas by `$id` with `$ref`. Duplicate `$id`s and unresolved `$ref`s fail readiness.
- Reference the artifact from at least one requirement (`R-<spec>-<n>`), and keep the requirement's wording consistent with the schema (required fields, types, ranges, enums).
- Confirm with `bish-bash-bosh ready`.
