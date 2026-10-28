import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.js';

const valid = () => ({
  roles: {
    build: { adapter: 'cli-agent', model: 'model-a' },
    review: { adapter: 'http-agent', model: 'model-b' },
  },
  budgets: { maxWallClockSeconds: 600, maxIterations: 10 },
  allowedPaths: ['src/**', 'test/**'],
});

test('accepts a valid config', () => {
  const r = validateConfig(valid());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('requires roles, budgets, allowedPaths', () => {
  for (const key of ['roles', 'budgets', 'allowedPaths']) {
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

test('budgets must be positive numbers and all present', () => {
  const c = valid();
  c.budgets.maxIterations = 0;
  assert.equal(validateConfig(c).ok, false);
  const d = valid();
  delete (/** @type {any} */ (d.budgets)).maxWallClockSeconds;
  assert.equal(validateConfig(d).ok, false);
  const e = /** @type {any} */ (valid());
  e.budgets.maxTokens = 1000;
  assert.equal(validateConfig(e).ok, false, 'token and cost budgets are not harness config');
  const f = /** @type {any} */ (valid());
  f.budgets.maxCostUsd = 5;
  assert.equal(validateConfig(f).ok, false);
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
