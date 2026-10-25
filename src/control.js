import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * @typedef {{ok: true, paused: boolean, stop: boolean, steer?: string} | {ok: false, reason: string}} ControlState
 */

/**
 * Reads `control.json`: `{paused?: boolean, stop?: boolean, steer?: string}`.
 * A missing file means "running, no note"; an unreadable or malformed file fails closed.
 * @param {string} file
 * @returns {ControlState}
 */
export function readControl(file) {
  if (!existsSync(file)) return { ok: true, paused: false, stop: false };
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false, reason: `invalid control file: ${/** @type {Error} */ (e).message}` };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid control file: expected an object' };
  }
  const c = /** @type {Record<string, unknown>} */ (raw);
  for (const k of ['paused', 'stop']) {
    if (c[k] !== undefined && typeof c[k] !== 'boolean') return { ok: false, reason: `invalid control file: '${k}' must be a boolean` };
  }
  if (c.steer !== undefined && typeof c.steer !== 'string') return { ok: false, reason: "invalid control file: 'steer' must be a string" };
  return {
    ok: true,
    paused: c.paused === true,
    stop: c.stop === true,
    ...(typeof c.steer === 'string' && c.steer !== '' ? { steer: c.steer } : {}),
  };
}

/**
 * Removes the steer note once it has been used, unless a newer note replaced it.
 * @param {string} file
 * @param {string} note
 */
export function consumeSteer(file, note) {
  if (!existsSync(file)) return;
  /** @type {Record<string, unknown>} */
  let c;
  try {
    c = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  if (c.steer !== note) return;
  delete c.steer;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(c));
  renameSync(tmp, file);
}
