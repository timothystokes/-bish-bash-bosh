Format: asyncapi (AsyncAPI 2.x/3.x, JSON or YAML). Use it for event and message contracts: channels, operations, message payloads.
- Declare under `## Formats` in the spec: `- asyncapi: specs/events/<name>.yaml`.
- The document must pass the official AsyncAPI schema, every local `$ref` must resolve, and operation ids must be unique within and across documents.
- Define a payload schema for every message, and reference the artifact from at least one requirement (`R-<spec>-<n>`).
- Confirm with `hodgepodge ready`.
