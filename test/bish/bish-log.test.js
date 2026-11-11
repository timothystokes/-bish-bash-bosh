import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/bish/bish-log.js';

test('createLogger appends one "[timestamp] source: text" line per call, in plain text, never JSON', () => {
  /** @type {[string, string][]} */
  const appended = [];
  const log = createLogger('/repo/.bish-bash-bosh/bish-log.md', (p, s) => appended.push([p, s]));
  log('bish', 'the full prompt sent this round');
  log('agent', 'the agent\'s streamed reasoning text');
  assert.equal(appended.length, 2);
  assert.equal(appended[0][0], '/repo/.bish-bash-bosh/bish-log.md');
  assert.match(appended[0][1], /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] bish: the full prompt sent this round\n$/);
  assert.match(appended[1][1], /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] agent: the agent's streamed reasoning text\n$/);
});

test('createLogger skips empty text entirely: no entry is appended, not even an empty one', () => {
  /** @type {unknown[]} */
  const appended = [];
  const log = createLogger('/repo/.bish-bash-bosh/bish-log.md', (p, s) => appended.push(s));
  log('agent', '');
  assert.equal(appended.length, 0);
});
