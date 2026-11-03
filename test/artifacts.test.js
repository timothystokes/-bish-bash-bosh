import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncArtifacts, requestPromotion } from '../src/artifacts.js';

/** @typedef {{bucket: string, key: string, body: Buffer, sha256: string}} Put */

function fakeS3() {
  /** @type {Map<string, string>} */
  const store = new Map();
  /** @type {Put[]} */
  const puts = [];
  return {
    puts,
    store,
    headObject: async (/** @type {{bucket: string, key: string}} */ i) => {
      const sha256 = store.get(i.key);
      return sha256 ? { sha256 } : null;
    },
    putObject: async (/** @type {Put} */ i) => {
      puts.push(i);
      store.set(i.key, i.sha256);
    },
  };
}

function runsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'bish-art-'));
  mkdirSync(join(dir, '.bish-bash-bosh', 'runs', 'r1', 'iterations', '001'), { recursive: true });
  writeFileSync(join(dir, '.bish-bash-bosh', 'runs', 'r1', 'iterations', '001', 'record.json'), '{"a":1}');
  writeFileSync(join(dir, '.bish-bash-bosh', 'runs', 'r1', 'summary.json'), '{"b":2}');
  writeFileSync(join(dir, '.bish-bash-bosh', 'runs', 'other.json'), 'x');
  return dir;
}

test('syncArtifacts uploads every file of the run under runs/<runId>/', async () => {
  const client = fakeS3();
  const r = await syncArtifacts({ client, bucket: 'b', repoDir: runsDir(), runId: 'r1' });
  assert.deepEqual(client.puts.map((p) => p.key).sort(), ['runs/r1/iterations/001/record.json', 'runs/r1/summary.json']);
  assert.equal(client.puts[0].bucket, 'b');
  assert.deepEqual({ uploaded: r.uploaded.length, skipped: r.skipped.length }, { uploaded: 2, skipped: 0 });
});

test('syncArtifacts is idempotent: unchanged files are skipped, changed files re-upload', async () => {
  const client = fakeS3();
  const repoDir = runsDir();
  await syncArtifacts({ client, bucket: 'b', repoDir, runId: 'r1' });
  const again = await syncArtifacts({ client, bucket: 'b', repoDir, runId: 'r1' });
  assert.equal(again.uploaded.length, 0);
  assert.equal(again.skipped.length, 2);
  writeFileSync(join(repoDir, '.bish-bash-bosh', 'runs', 'r1', 'summary.json'), '{"b":3}');
  const third = await syncArtifacts({ client, bucket: 'b', repoDir, runId: 'r1' });
  assert.deepEqual(third.uploaded, ['runs/r1/summary.json']);
});

test('syncArtifacts returns empty for a run with no records and rejects unsafe run ids', async () => {
  const client = fakeS3();
  const r = await syncArtifacts({ client, bucket: 'b', repoDir: runsDir(), runId: 'nope' });
  assert.deepEqual(r, { uploaded: [], skipped: [] });
  await assert.rejects(syncArtifacts({ client, bucket: 'b', repoDir: runsDir(), runId: '../x' }), /runId/);
  await assert.rejects(syncArtifacts({ client, bucket: '', repoDir: runsDir(), runId: 'r1' }), /bucket/);
});

test('requestPromotion opens a PR from the sandbox branch and never merges', async () => {
  /** @type {{title: string, body: string, head: string, base: string}[]} */
  const calls = [];
  const opener = {
    openPullRequest: async (/** @type {{title: string, body: string, head: string, base: string}} */ i) => {
      calls.push(i);
      return { url: 'https://example.test/pr/1' };
    },
  };
  const r = await requestPromotion({ opener, runId: 'r1', head: 'bish/r1', base: 'main', artifactsUri: 's3://b/runs/r1/', sha: 'abc123' });
  assert.deepEqual(r, { url: 'https://example.test/pr/1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].head, 'bish/r1');
  assert.equal(calls[0].base, 'main');
  assert.match(calls[0].title, /r1/);
  assert.match(calls[0].body, /abc123/);
  assert.match(calls[0].body, /s3:\/\/b\/runs\/r1\//);
});

test('requestPromotion refuses head equal to base or missing fields', async () => {
  const opener = { openPullRequest: async () => ({ url: 'x' }) };
  await assert.rejects(requestPromotion({ opener, runId: 'r1', head: 'main', base: 'main', artifactsUri: 'u', sha: 's' }), /head/);
  await assert.rejects(requestPromotion({ opener, runId: '', head: 'h', base: 'main', artifactsUri: 'u', sha: 's' }), /runId/);
});
