import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAwsCliS3Client, createGhPrOpener } from '../src/cloud-clients.js';
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

test('s3 client headObject reads the sha256 metadata via the aws CLI', async () => {
  const f = fakeRun(() => ({ code: 0, stdout: JSON.stringify({ Metadata: { sha256: 'abc' } }) }));
  const c = createAwsCliS3Client({ run: f.run });
  assert.deepEqual(await c.headObject({ bucket: 'b', key: 'runs/r/x.json' }), { sha256: 'abc' });
  assert.deepEqual(f.calls[0].args.slice(0, 2), ['s3api', 'head-object']);
  assert.ok(f.calls[0].args.includes('b') && f.calls[0].args.includes('runs/r/x.json'));
});

test('s3 client headObject returns null for a missing object, throws on other errors', async () => {
  const missing = createAwsCliS3Client({ run: fakeRun(() => ({ code: 254, stderr: 'An error occurred (404) when calling the HeadObject operation: Not Found' })).run });
  assert.equal(await missing.headObject({ bucket: 'b', key: 'k' }), null);
  const bad = createAwsCliS3Client({ run: fakeRun(() => ({ code: 255, stderr: 'AccessDenied' })).run });
  await assert.rejects(bad.headObject({ bucket: 'b', key: 'k' }), /AccessDenied/);
});

test('s3 client putObject stores the body with sha256 metadata', async () => {
  const f = fakeRun(() => ({ code: 0, stdout: '{}' }));
  const c = createAwsCliS3Client({ run: f.run });
  await c.putObject({ bucket: 'b', key: 'k', body: Buffer.from('hi'), sha256: 'abc' });
  const a = f.calls[0].args;
  assert.deepEqual(a.slice(0, 2), ['s3api', 'put-object']);
  assert.ok(a.join(' ').includes('sha256=abc'));
  const failing = createAwsCliS3Client({ run: fakeRun(() => ({ code: 1, stderr: 'boom' })).run });
  await assert.rejects(failing.putObject({ bucket: 'b', key: 'k', body: Buffer.from('x'), sha256: 'z' }), /boom/);
});

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

test('help documents hodgepodge sync and hodgepodge promote', () => {
  assert.match(helpText(), /hodgepodge sync --bucket/);
  assert.match(helpText(), /hodgepodge promote --run-id/);
});

test('hodgepodge sync uploads run records, then skips them on a repeat', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'hodge-sync-'));
  mkdirSync(join(repo, 'runs', 'r1'), { recursive: true });
  writeFileSync(join(repo, 'runs', 'r1', 'a.json'), '{}');
  /** @type {Record<string, string>} */
  const store = {};
  const exec = fakeRun(({ args }) => {
    const key = args[args.indexOf('--key') + 1];
    if (args[1] === 'put-object') {
      store[key] = args[args.indexOf('--metadata') + 1].replace('sha256=', '');
      return { code: 0, stdout: '{}' };
    }
    return key in store ? { code: 0, stdout: JSON.stringify({ Metadata: { sha256: store[key] } }) } : { code: 254, stderr: 'Not Found' };
  });
  /** @type {string[]} */
  const outs = [];
  const args = ['sync', '--bucket', 'bkt', '--run-id', 'r1', '--repo', repo];
  assert.equal(await main(args, { stdout: (s) => outs.push(s), exec: exec.run }), 0);
  assert.deepEqual(JSON.parse(outs[0]).uploaded, ['runs/r1/a.json']);
  assert.equal(await main(args, { stdout: (s) => outs.push(s), exec: exec.run }), 0);
  assert.deepEqual(JSON.parse(outs[1]).skipped, ['runs/r1/a.json']);
});

test('hodgepodge sync/promote reject missing or unknown args (exit 2)', async () => {
  /** @type {string[]} */
  const errs = [];
  const e = { stderr: (/** @type {string} */ s) => errs.push(s) };
  assert.equal(await main(['sync', '--run-id', 'r1'], e), 2);
  assert.match(errs.join(''), /--bucket/);
  assert.equal(await main(['sync', '--bucket', 'b', '--run-id', 'r1', '--bogus', 'x'], e), 2);
  assert.equal(await main(['promote', '--run-id', 'r1', '--head', 'h'], e), 2);
  assert.equal(await main(['promote', '--run-id', 'r1', '--head', 'x', '--base', 'x', '--bucket', 'b'], { ...e, exec: fakeRun(() => ({ code: 0 })).run }), 2);
});

test('hodgepodge promote opens a PR with head sha and artifacts URI', async () => {
  const exec = fakeRun(({ cmd }) => (cmd === 'gh' ? { code: 0, stdout: 'https://github.com/o/r/pull/9\n' } : { code: 0, stdout: 'abc123\n' }));
  /** @type {string[]} */
  const outs = [];
  const code = await main(['promote', '--run-id', 'r1', '--head', 'sandbox', '--base', 'main', '--bucket', 'bkt', '--sha', 'abc123'], { stdout: (s) => outs.push(s), exec: exec.run });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(outs[0]), { url: 'https://github.com/o/r/pull/9' });
  const gh = exec.calls.find((c) => c.cmd === 'gh');
  assert.ok(gh?.args.join(' ').includes('s3://bkt/runs/r1/'));
  assert.ok(gh?.args.join(' ').includes('abc123'));
});
