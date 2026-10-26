Format: ebnf (W3C EBNF notation). Use it for input and output grammars: command syntax, file formats, expressions.
- Declare under `## Formats` in the spec: `- ebnf: specs/grammars/<name>.ebnf`.
- The grammar must parse and every referenced rule must be defined. The first rule is the start rule.
- Declare examples as comments, at least one of each kind: `/* accept: "<JSON string>" */` must match the whole start rule, `/* reject: "<JSON string>" */` must not. A malformed example comment fails readiness.
- Reference the artifact from at least one requirement (`R-<spec>-<n>`).
- Confirm with `hodgepodge ready`.
