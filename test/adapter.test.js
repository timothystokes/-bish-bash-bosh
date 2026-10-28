import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAdapterResult, createFakeAdapter } from '../src/adapter.js';
import { adapterContract } from './helpers/adapter-contract.js';

const good = () => ({
  exitStatus: 0,
  transcript: 't',
  changedFiles: ['a'],
});

test('validateAdapterResult accepts a good result', () => {
  assert.deepEqual(validateAdapterResult(good()), { ok: true, errors: [] });
});

test('validateAdapterResult rejects bad shapes', () => {
  assert.equal(validateAdapterResult(null).ok, false);
  assert.equal(validateAdapterResult({ ...good(), exitStatus: '0' }).ok, false);
  assert.equal(validateAdapterResult({ ...good(), transcript: 1 }).ok, false);
  assert.equal(validateAdapterResult({ ...good(), changedFiles: [1] }).ok, false);
  assert.equal(validateAdapterResult({ ...good(), changedFiles: undefined }).ok, false);
});

adapterContract('fake adapter', createFakeAdapter);
