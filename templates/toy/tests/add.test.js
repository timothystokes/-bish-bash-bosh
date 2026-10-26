import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../src/add.js';
import { add } from '../src/add.js';

test('R-add-1: exports a named function add', () => {
  assert.equal(typeof mod.add, 'function');
});

test('R-add-2: returns the numeric sum', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
});

test('R-add-3: rejects non-finite-number arguments', () => {
  assert.throws(() => add('2', 3), TypeError);
  assert.throws(() => add(1, NaN), TypeError);
  assert.throws(() => add(Infinity, 1), TypeError);
});
