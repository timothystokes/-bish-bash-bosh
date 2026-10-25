import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { helpText } from '../src/cli.js';

test('helpText mentions hodge and usage', () => {
  assert.match(helpText(), /^hodge/);
  assert.match(helpText(), /Usage:/);
});

test('bin/hodge --help prints help and exits 0', () => {
  const out = execFileSync('node', ['bin/hodge', '--help'], { encoding: 'utf8' });
  assert.equal(out.trim(), helpText().trim());
});

test('bin/hodge with no args prints help', () => {
  const out = execFileSync('node', ['bin/hodge'], { encoding: 'utf8' });
  assert.match(out, /Usage:/);
});
