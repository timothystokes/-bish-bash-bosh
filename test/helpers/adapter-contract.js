import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAdapterResult } from '../../src/adapter.js';

/**
 * Contract suite every adapter must pass. No network: `makeAdapter` receives a
 * fixture describing the scripted fake agent behaviour and returns an Adapter.
 * @param {string} name
 * @param {(fixture: import('../../src/adapter.js').FakeFixture) => import('../../src/adapter.js').Adapter} makeAdapter
 */
export function adapterContract(name, makeAdapter) {
  const limits = { maxTokens: 1000, maxCostUsd: 1, maxWallClockSeconds: 60 };
  /**
   * @param {(cwd: string) => Promise<void>} fn
   */
  const withDir = async (fn) => {
    const cwd = mkdtempSync(join(tmpdir(), 'hodge-adapter-'));
    try {
      return await fn(cwd);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  };

  test(`${name}: success returns a valid result with changedFiles`, () =>
    withDir(async (/** @type {string} */ cwd) => {
      const adapter = makeAdapter({
        exitStatus: 0,
        transcript: 'did the thing',
        usage: { tokens: 120, cost: 0.01 },
        writes: { 'src/a.js': 'x', 'b.txt': 'y' },
      });
      const r = await adapter.run({ prompt: 'p', cwd, limits });
      assert.deepEqual(validateAdapterResult(r), { ok: true, errors: [] });
      assert.equal(r.exitStatus, 0);
      assert.equal(r.transcript, 'did the thing');
      assert.deepEqual(r.usage, { tokens: 120, cost: 0.01 });
      assert.deepEqual([...r.changedFiles].sort(), ['b.txt', 'src/a.js']);
      assert.equal(readFileSync(join(cwd, 'src/a.js'), 'utf8'), 'x');
    }));

  test(`${name}: agent failure still yields a valid result, not a throw`, () =>
    withDir(async (/** @type {string} */ cwd) => {
      const adapter = makeAdapter({
        exitStatus: 2,
        transcript: 'boom',
        usage: { tokens: 5, cost: 0 },
        writes: {},
      });
      const r = await adapter.run({ prompt: 'p', cwd, limits });
      assert.equal(validateAdapterResult(r).ok, true);
      assert.equal(r.exitStatus, 2);
      assert.deepEqual(r.changedFiles, []);
    }));

  test(`${name}: usage over limits is reported as non-zero exit`, () =>
    withDir(async (/** @type {string} */ cwd) => {
      const adapter = makeAdapter({
        exitStatus: 0,
        transcript: 'big',
        usage: { tokens: 5000, cost: 0.5 },
        writes: {},
      });
      const r = await adapter.run({ prompt: 'p', cwd, limits });
      assert.equal(validateAdapterResult(r).ok, true);
      assert.notEqual(r.exitStatus, 0);
      assert.equal(r.usage.tokens, 5000);
    }));

  test(`${name}: changedFiles are relative paths inside cwd`, () =>
    withDir(async (/** @type {string} */ cwd) => {
      const adapter = makeAdapter({
        exitStatus: 0,
        transcript: '',
        usage: { tokens: 1, cost: 0 },
        writes: { 'deep/er/file.js': 'z' },
      });
      const r = await adapter.run({ prompt: 'p', cwd, limits });
      for (const f of r.changedFiles) {
        assert.ok(!f.startsWith('/') && !f.split('/').includes('..'), f);
      }
    }));
}
