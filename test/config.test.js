import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.js';

const valid = () => ({
  adapter: 'cli-agent',
  model: 'model-a',
});

test('accepts a valid config', () => {
  const r = validateConfig(valid());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('requires adapter, model', () => {
  for (const key of ['adapter', 'model']) {
    const c = /** @type {Record<string, unknown>} */ (valid());
    delete c[key];
    const r = validateConfig(c);
    assert.equal(r.ok, false, key);
    assert.ok(r.errors.some((e) => e.includes(key)), key);
  }
});

test('rejects unknown top-level keys', () => {
  assert.equal(validateConfig({ ...valid(), extra: 1 }).ok, false);
});

test('rejects non-object input', () => {
  assert.equal(validateConfig(null).ok, false);
});
