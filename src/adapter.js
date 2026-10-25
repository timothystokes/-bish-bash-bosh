import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @typedef {{maxTokens?: number, maxCostUsd?: number, maxWallClockSeconds?: number}} Limits
 * @typedef {{prompt: string, cwd: string, limits: Limits}} AdapterRequest
 * @typedef {{tokens: number, cost: number}} Usage
 * @typedef {{exitStatus: number, transcript: string, usage: Usage, changedFiles: string[]}} AdapterResult
 * @typedef {{run: (req: AdapterRequest) => Promise<AdapterResult>}} Adapter
 * @typedef {{exitStatus: number, transcript: string, usage: Usage, writes: Record<string, string>}} FakeFixture
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
  if (typeof o.usage !== 'object' || o.usage === null) {
    errors.push('usage must be an object');
  } else {
    if (!isNum(o.usage.tokens)) errors.push('usage.tokens must be a non-negative number');
    if (!isNum(o.usage.cost)) errors.push('usage.cost must be a non-negative number');
  }
  if (!Array.isArray(o.changedFiles) || o.changedFiles.some((f) => typeof f !== 'string')) {
    errors.push('changedFiles must be an array of strings');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Scripted fake agent for contract tests; performs no network or process calls.
 * Reports a non-zero exit when scripted usage exceeds the given limits.
 * @param {FakeFixture} fixture
 * @returns {Adapter}
 */
export function createFakeAdapter(fixture) {
  return {
    async run({ cwd, limits }) {
      const changedFiles = [];
      for (const [rel, content] of Object.entries(fixture.writes)) {
        const full = join(cwd, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
        changedFiles.push(rel);
      }
      const { tokens, cost } = fixture.usage;
      const over =
        (limits.maxTokens !== undefined && tokens > limits.maxTokens) ||
        (limits.maxCostUsd !== undefined && cost > limits.maxCostUsd);
      return {
        exitStatus: fixture.exitStatus !== 0 ? fixture.exitStatus : over ? 1 : 0,
        transcript: fixture.transcript,
        usage: { tokens, cost },
        changedFiles,
      };
    },
  };
}
