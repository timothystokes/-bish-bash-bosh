import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, helpText } from '../src/cli.js';

/**
 * @param {string[]} args
 */
async function run(args, docker) {
  /** @type {string[]} */
  const outs = [];
  /** @type {string[]} */
  const errs = [];
  const code = await main(args, { docker, stdout: (s) => outs.push(s), stderr: (s) => errs.push(s) });
  return { code, out: outs.join(''), err: errs.join('') };
}

test('help lists kill', () => {
  assert.match(helpText(), /hodgepodge kill --container/);
});

test('kill writes control stop then docker stop, prints a confirmation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kill-'));
  const control = join(dir, 'control.json');
  /** @type {string[][]} */
  const calls = [];
  const r = await run(['kill', '--container', 'run1', '--control', control, '--grace', '3'], async (a) => {
    calls.push(a);
    assert.equal(JSON.parse(readFileSync(control, 'utf8')).stop, true);
    return { code: 0, stdout: '', stderr: '' };
  });
  assert.equal(r.code, 0);
  assert.equal(r.out, 'stopped run1\n');
  assert.deepEqual(calls, [['stop', '--time', '3', 'run1']]);
});

test('kill of a vanished container exits 0 with stopped:false', async () => {
  const r = await run(['kill', '--container', 'gone'], async () => ({ code: 1, stdout: '', stderr: 'Error: No such container: gone' }));
  assert.equal(r.code, 0);
  assert.match(r.out, /not stopped gone: container does not exist/);
});

test('kill surfaces docker failure with exit 1', async () => {
  const r = await run(['kill', '--container', 'x'], async () => ({ code: 1, stdout: '', stderr: 'daemon down' }));
  assert.equal(r.code, 1);
  assert.match(r.err, /daemon down/);
});

test('kill bad usage exits 2', async () => {
  for (const args of [['kill'], ['kill', '--container'], ['kill', '--container', '-x'], ['kill', '--container', 'a', '--grace', 'abc'], ['kill', '--bogus', 'a']]) {
    const r = await run(args, async () => ({ code: 0, stdout: '', stderr: '' }));
    assert.equal(r.code, 2, args.join(' '));
  }
});
