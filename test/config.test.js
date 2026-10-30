import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.js';

const valid = () => ({
  roles: {
    build: { adapter: 'cli-agent', model: 'model-a' },
    review: { adapter: 'http-agent', model: 'model-b' },
  },
  allowedPaths: ['src/**', 'test/**'],
});

test('accepts a valid config', () => {
  const r = validateConfig(valid());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('requires roles, allowedPaths', () => {
  for (const key of ['roles', 'allowedPaths']) {
    const c = /** @type {Record<string, unknown>} */ (valid());
    delete c[key];
    const r = validateConfig(c);
    assert.equal(r.ok, false, key);
    assert.ok(r.errors.some((e) => e.includes(key)), key);
  }
});

test('requires a build role', () => {
  const c = valid();
  delete (/** @type {any} */ (c.roles)).build;
  assert.equal(validateConfig(c).ok, false);
});

test('role needs adapter and model', () => {
  for (const key of ['adapter', 'model']) {
    const c = valid();
    delete (/** @type {any} */ (c.roles.build))[key];
    assert.equal(validateConfig(c).ok, false, key);
  }
});

test('allowedPaths must be a non-empty array of strings', () => {
  const c = valid();
  c.allowedPaths = [];
  assert.equal(validateConfig(c).ok, false);
});

test('rejects unknown top-level keys', () => {
  assert.equal(validateConfig({ ...valid(), extra: 1 }).ok, false);
});

test('rejects non-object input', () => {
  assert.equal(validateConfig(null).ok, false);
});
