// The starting point the harness writes for an item's test file (only when it doesn't exist yet), so the
// Test Writer starts from the harness import and the conventions rather than a blank file.
export default (task, specs) => `// Tests for: ${task.replace(/\s+/g, ' ')}
//
// Written by the Test Writer, run by the harness. Guidance:
// - Import helpers from '../test-harness.js' and use node:test.
// - Exercise the project from the outside (run the command or server a user would run, then check exit status,
//   output or an HTTP response). Do not import the project's internals.
// - Name every test ${specs.length ? `starting with ${specs.map((n) => `S${n}`).join(', ')} as \`[${specs.map((n) => `S${n}`).join(', ')}] ...\`` : 'for what it proves'}; the harness ticks specification items from those names.
// - Tests must fail on an assertion (not error) until the behaviour exists.
import { test } from 'node:test';
import { assert, runCommand, httpRequest } from '../test-harness.js';

// test('${specs.length ? `[${specs.map((n) => `S${n}`).join(', ')}] ` : ''}describe the behaviour', async () => {
// });
`;
