import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { helpText } from '../src/cli.js';

test('helpText mentions bish and usage', () => {
  assert.match(helpText(), /bish-bash-bosh: model-agnostic harness/);
  assert.match(helpText(), /Usage:/);
});

test('helpText no longer documents a --dir flag; every command operates on cwd', () => {
  assert.doesNotMatch(helpText(), /--dir <sandbox>/);
  assert.match(helpText(), /no `--dir` flag/);
  assert.match(helpText(), /\.bish-bash-bosh\/config\.yml/);
});

test('bin/bish-bash-bosh --help prints help and exits 0', () => {
  const out = execFileSync('node', ['bin/bish-bash-bosh', '--help'], { encoding: 'utf8' });
  assert.equal(out.trim(), helpText().trim());
});

test('bin/bish-bash-bosh with no args prints help', () => {
  const out = execFileSync('node', ['bin/bish-bash-bosh'], { encoding: 'utf8' });
  assert.match(out, /Usage:/);
});

test('bin/bish, bin/bash and bin/bosh --help print the shared help', () => {
  for (const b of ['bish', 'bash', 'bosh']) {
    assert.equal(execFileSync('node', [`bin/${b}`, '--help'], { encoding: 'utf8' }).trim(), helpText().trim());
  }
});

test('the logo is printed to stderr (not stdout) for every command', async () => {
  const { main, LOGO } = await import('../src/cli.js');
  /** @type {string[]} */
  const outs = [];
  /** @type {string[]} */
  const errs = [];
  await main(['status'], { stdout: (s) => outs.push(s), stderr: (s) => errs.push(s) });
  assert.match(errs.join(''), new RegExp(LOGO.split('\n').map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\n')));
  assert.doesNotMatch(outs.join(''), /BISH.*BASH.*BOSH/);
});

test('removed commands are rejected', async () => {
  const { main } = await import('../src/cli.js');
  for (const c of ['step', 'run', 'interview', 'objective', 'reverse']) {
    assert.equal(await main([c], { stdout: () => {}, stderr: () => {} }), 2, c);
  }
});

test('bin/bish-bash-bosh does not host bish, bash or bosh', () => {
  for (const c of ['bish', 'bash', 'bosh']) {
    assert.equal(spawnSync('node', ['bin/bish-bash-bosh', c], { encoding: 'utf8' }).status, 2, c);
  }
});
