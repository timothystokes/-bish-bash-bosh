import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGhPrOpener } from '../src/pr-opener.js';
import { main, helpText } from '../src/cli.js';

/** @typedef {{cmd: string, args: string[]}} Call */

/**
 * @param {(c: Call) => {code: number, stdout?: string, stderr?: string}} fn
 * @returns {{run: (cmd: string, args: string[]) => Promise<{code: number, stdout: string, stderr: string}>, calls: Call[]}}
 */
function fakeRun(fn) {
  /** @type {Call[]} */
  const calls = [];
  return {
    calls,
    run: async (cmd, args) => {
      calls.push({ cmd, args });
      const r = fn({ cmd, args });
      return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    },
  };
}

test('gh opener runs gh pr create (never merge) and returns the URL', async () => {
  const f = fakeRun(() => ({ code: 0, stdout: 'https://github.com/o/r/pull/7\n' }));
  const o = createGhPrOpener({ run: f.run, cwd: '/tmp' });
  assert.deepEqual(await o.openPullRequest({ title: 'T', body: 'B', head: 'sandbox', base: 'main' }), { url: 'https://github.com/o/r/pull/7' });
  assert.equal(f.calls[0].cmd, 'gh');
  assert.deepEqual(f.calls[0].args.slice(0, 2), ['pr', 'create']);
  assert.ok(!f.calls[0].args.includes('merge'));
  const failing = createGhPrOpener({ run: fakeRun(() => ({ code: 1, stderr: 'nope' })).run });
  await assert.rejects(failing.openPullRequest({ title: 'T', body: 'B', head: 'h', base: 'b' }), /nope/);
});

test('help documents bish-bash-bosh promote, and sync is gone', () => {
  assert.match(helpText(), /bish-bash-bosh promote --run-id/);
  assert.doesNotMatch(helpText(), /bish-bash-bosh sync/);
});

test('bish-bash-bosh promote rejects missing or unknown args and head equal to base (exit 2)', async () => {
  /** @type {string[]} */
  const errs = [];
  const e = { stderr: (/** @type {string} */ s) => errs.push(s) };
  assert.equal(await main(['promote', '--run-id', 'r1', '--head', 'h'], e), 2);
  assert.match(errs.join(''), /--base/);
  assert.equal(await main(['promote', '--run-id', 'r1', '--head', 'h', '--base', 'b', '--bogus', 'x'], e), 2);
  assert.equal(await main(['promote', '--run-id', 'r1', '--head', 'x', '--base', 'x'], { ...e, exec: fakeRun(() => ({ code: 0 })).run }), 2);
});

test('bish-bash-bosh promote opens a PR with head sha', async () => {
  const exec = fakeRun(({ cmd }) => (cmd === 'gh' ? { code: 0, stdout: 'https://github.com/o/r/pull/9\n' } : { code: 0, stdout: 'abc123\n' }));
  /** @type {string[]} */
  const outs = [];
  const code = await main(['promote', '--run-id', 'r1', '--head', 'sandbox', '--base', 'main', '--sha', 'abc123'], { stdout: (s) => outs.push(s), exec: exec.run });
  assert.equal(code, 0);
  assert.equal(outs[0], 'promotion PR opened: https://github.com/o/r/pull/9\n');
  const gh = exec.calls.find((c) => c.cmd === 'gh');
  assert.ok(gh?.args.join(' ').includes('abc123'));
});
