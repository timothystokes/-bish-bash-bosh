import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { helpText } from '../../src/cli/cli.js';

test('helpText mentions bish and usage', () => {
  assert.match(helpText(), /-bish-bash-bosh: harness for loop engineering/);
  assert.match(helpText(), /Usage:/);
});

test('helpText no longer documents a --dir flag; every command operates on cwd', () => {
  assert.doesNotMatch(helpText(), /--dir <sandbox>/);
  assert.match(helpText(), /no `--dir` flag/);
  assert.match(helpText(), /\.bish-bash-bosh\/config\.yml/);
});

test('bin/-bish, bin/-bash and bin/-bosh --help print the shared help', () => {
  for (const b of ['-bish', '-bash', '-bosh']) {
    assert.equal(execFileSync('node', [`bin/${b}`, '--help'], { encoding: 'utf8' }).trim(), helpText().trim());
  }
});

test('the logo is printed to stderr (not stdout) for every command', async () => {
  const { main, LOGO } = await import('../../src/cli/cli.js');
  /** @type {string[]} */
  const outs = [];
  /** @type {string[]} */
  const errs = [];
  await main(['--help'], { stdout: (s) => outs.push(s), stderr: (s) => errs.push(s) });
  assert.match(errs.join(''), new RegExp(LOGO.split('\n').map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\n')));
  assert.doesNotMatch(outs.join(''), /BISH.*BASH.*BOSH/);
});

test('removed commands are rejected', async () => {
  const { main } = await import('../../src/cli/cli.js');
  for (const c of ['step', 'run', 'interview', 'objective', 'reverse']) {
    assert.equal(await main([c], { stdout: () => {}, stderr: () => {} }), 2, c);
  }
});
