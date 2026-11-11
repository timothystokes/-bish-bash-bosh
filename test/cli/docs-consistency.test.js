import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { helpText } from '../../src/cli/cli.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (/** @type {string} */ p) => readFileSync(join(root, p), 'utf8');

/** @returns {string[]} commands named in the help `Commands:` section */
function helpCommands() {
  const section = helpText().split('\nCommands:\n')[1];
  return [...section.matchAll(/^ {2}(-\w+) \[/gm)].map((m) => m[1]);
}

test('G-4: every CLI command is documented in README or a spec', () => {
  const docs = [read('README.md'), ...['adapters', 'gates', 'loop', 'modes', 'repos'].map((s) => read(`specs/${s}.md`))].join('\n');
  const cmds = helpCommands();
  assert.deepEqual(cmds, ['-bish', '-bash', '-bosh']);
  for (const c of cmds) assert.ok(docs.includes(`\`${c}\``), `command '${c}' is in CLI help but undocumented`);
});
