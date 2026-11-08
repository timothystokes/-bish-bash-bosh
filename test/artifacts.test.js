import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestPromotion } from '../src/artifacts.js';

test('requestPromotion opens a PR from the sandbox branch and never merges', async () => {
  /** @type {{title: string, body: string, head: string, base: string}[]} */
  const calls = [];
  const opener = {
    openPullRequest: async (/** @type {{title: string, body: string, head: string, base: string}} */ i) => {
      calls.push(i);
      return { url: 'https://example.test/pr/1' };
    },
  };
  const r = await requestPromotion({ opener, runId: 'r1', head: 'bish/r1', base: 'main', sha: 'abc123' });
  assert.deepEqual(r, { url: 'https://example.test/pr/1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].head, 'bish/r1');
  assert.equal(calls[0].base, 'main');
  assert.match(calls[0].title, /r1/);
  assert.match(calls[0].body, /abc123/);
});

test('requestPromotion refuses head equal to base or missing fields', async () => {
  const opener = { openPullRequest: async () => ({ url: 'x' }) };
  await assert.rejects(requestPromotion({ opener, runId: 'r1', head: 'main', base: 'main', sha: 's' }), /head/);
  await assert.rejects(requestPromotion({ opener, runId: '', head: 'h', base: 'main', sha: 's' }), /runId/);
});
