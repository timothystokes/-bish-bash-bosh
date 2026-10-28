import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @typedef {{maxWallClockSeconds?: number}} Limits
 * @typedef {{prompt: string, cwd: string, limits: Limits, onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void}} AdapterRequest
 * @typedef {{exitStatus: number, transcript: string, changedFiles: string[]}} AdapterResult
 * @typedef {{run: (req: AdapterRequest) => Promise<AdapterResult>}} Adapter
 * @typedef {{exitStatus: number, transcript: string, writes: Record<string, string>}} FakeFixture
 */

/** @param {unknown} v */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Check a value has the common adapter result shape.
 * @param {unknown} r
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateAdapterResult(r) {
  const errors = [];
  if (typeof r !== 'object' || r === null) return { ok: false, errors: ['result must be an object'] };
  const o = /** @type {Record<string, any>} */ (r);
  if (!Number.isInteger(o.exitStatus)) errors.push('exitStatus must be an integer');
  if (typeof o.transcript !== 'string') errors.push('transcript must be a string');
  if (!Array.isArray(o.changedFiles) || o.changedFiles.some((f) => typeof f !== 'string')) {
    errors.push('changedFiles must be an array of strings');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Scripted fake agent for contract tests; performs no network or process calls.
 * @param {FakeFixture} fixture
 * @returns {Adapter}
 */
export function createFakeAdapter(fixture) {
  return {
    async run({ cwd }) {
      const changedFiles = [];
      for (const [rel, content] of Object.entries(fixture.writes)) {
        const full = join(cwd, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
        changedFiles.push(rel);
      }
      return { exitStatus: fixture.exitStatus, transcript: fixture.transcript, changedFiles };
    },
  };
}
