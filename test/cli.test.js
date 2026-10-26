import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { helpText } from '../src/cli.js';

test('helpText mentions hodge and usage', () => {
  assert.match(helpText(), /^hodgepodge/);
  assert.match(helpText(), /Usage:/);
});

test('bin/hodgepodge --help prints help and exits 0', () => {
  const out = execFileSync('node', ['bin/hodgepodge', '--help'], { encoding: 'utf8' });
  assert.equal(out.trim(), helpText().trim());
});

test('bin/hodgepodge with no args prints help', () => {
  const out = execFileSync('node', ['bin/hodgepodge'], { encoding: 'utf8' });
  assert.match(out, /Usage:/);
});

test('bin/hodge and bin/podge --help print the shared help', () => {
  for (const b of ['hodge', 'podge']) {
    assert.equal(execFileSync('node', [`bin/${b}`, '--help'], { encoding: 'utf8' }).trim(), helpText().trim());
  }
});

test('podge step runs one iteration', async () => {
  const { main } = await import('../src/cli.js');
  /** @type {string[]} */
  const errs = [];
  const code = await main(['podge', 'step', '--dir', '/nonexistent/sandbox'], { stdout: () => {}, stderr: (s) => { errs.push(s); } });
  assert.equal(code, 2);
  assert.match(errs.join(''), /^podge step: /);
});

test('removed commands are rejected', async () => {
  const { main } = await import('../src/cli.js');
  for (const c of ['step', 'run', 'interview', 'objective', 'reverse']) {
    assert.equal(await main([c], { stdout: () => {}, stderr: () => {} }), 2, c);
  }
});

test('bin/hodgepodge does not host hodge, podge or step', () => {
  for (const c of ['hodge', 'podge', 'step']) {
    assert.equal(spawnSync('node', ['bin/hodgepodge', c], { encoding: 'utf8' }).status, 2, c);
  }
  assert.equal(spawnSync('node', ['bin/hodgepodge', 'podge', 'step'], { encoding: 'utf8' }).status, 2);
});
