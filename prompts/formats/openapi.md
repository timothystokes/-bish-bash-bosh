Format: openapi (OpenAPI 3.0/3.1/3.2, JSON or YAML). Use it for HTTP APIs: routes, parameters, request and response bodies, status codes.
- Declare under `## Formats` in the spec: `- openapi: specs/api/<name>.yaml`.
- The document must pass the official OpenAPI schema, every local `$ref` must resolve, and every `operationId` must be unique within and across documents.
- Give every operation an `operationId`, describe error responses, and reference the artifact from at least one requirement (`R-<spec>-<n>`).
- Confirm with `bish-bash-bosh ready`.
