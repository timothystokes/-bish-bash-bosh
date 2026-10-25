import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/add.js';

test('adds two numbers', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
});

test('rejects non-finite-number arguments', () => {
  assert.throws(() => add('2', 3), TypeError);
  assert.throws(() => add(1, NaN), TypeError);
  assert.throws(() => add(Infinity, 1), TypeError);
});
