import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { helpText } from '../src/cli.js';
import { FORMATS } from '../src/formats.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (/** @type {string} */ p) => readFileSync(join(root, p), 'utf8');

/** @param {string} text @returns {string[] | undefined} format ids from the "Known formats:" sentence */
function knownFormats(text) {
  const m = /Known formats: ([^\n]*)/.exec(text);
  if (!m) return undefined;
  return [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]).sort();
}

const registry = Object.keys(FORMATS).sort();

for (const [name, text] of /** @type {[string, () => string][]} */ ([
  ['README.md', () => read('README.md')],
  ['specs/formats.md', () => read('specs/formats.md')],
  ['templates/objective/READINESS.md', () => read('templates/objective/READINESS.md')],
  ['CLI help', () => helpText()],
])) {
  test(`G-4: ${name} lists exactly the registered formats`, () => {
    assert.deepEqual(knownFormats(text()), registry);
  });
}

/** @returns {string[]} commands named in the help `Commands:` section */
function helpCommands() {
  const section = helpText().split('\nCommands:\n')[1];
  return [...section.matchAll(/^ {2}(\S+(?: step)?) {2,}\S/gm)].map((m) => m[1]);
}

test('G-4: every CLI command is documented in README or a spec', () => {
  const docs = [read('README.md'), ...['adapters', 'cloud-driver', 'control-and-safety', 'formats', 'gates', 'loop', 'modes', 'repos'].map((s) => read(`specs/${s}.md`))].join('\n');
  const cmds = helpCommands();
  assert.ok(cmds.length >= 14, `parsed commands: ${cmds.join(', ')}`);
  for (const c of cmds) {
    const pattern = ['hodge', 'podge'].includes(c) ? new RegExp(`\\b${c}\\b`) : new RegExp(`hodgepodge ${c}\\b|\`${c}( step)?\``);
    assert.match(docs, pattern, `command '${c}' is in CLI help but undocumented`);
  }
});

test('G-4: every `hodgepodge <command>` in README exists in the CLI help', () => {
  const known = new Set(helpCommands());
  const used = [...read('README.md').matchAll(/(?:npx )?hodgepodge ([a-z][a-z-]*)/g)].map((m) => m[1]);
  for (const c of used) assert.ok(known.has(c), `README uses 'hodgepodge ${c}', not in CLI help`);
});

test('G-8: Dockerfile installs production dependencies, and every validator package src/formats.js imports is one', () => {
  const docker = read('Dockerfile');
  assert.match(docker, /COPY package\.json package-lock\.json/);
  assert.match(docker, /npm ci --omit=dev/);
  const pkg = JSON.parse(read('package.json'));
  const src = read('src/formats.js');
  const imported = [...src.matchAll(/from '([^'./][^']*)'/g)].map((m) => m[1]).filter((p) => !p.startsWith('node:'));
  assert.ok(imported.length >= 5);
  for (const spec of imported) {
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    assert.ok(pkg.dependencies[name], `${name} must be a runtime dependency to exist in the image`);
  }
});

test('G-8: the embedded validators do not use the network', () => {
  assert.doesNotMatch(read('src/formats.js'), /\bfetch\(|node:https?|\bloadSchema\b/);
});
