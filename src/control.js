import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

// Reads `control.json`: `{paused?: boolean, stop?: boolean, steer?: string}`.
// A missing file means "running, no note"; an unreadable or malformed file fails closed.
export function readControl(file) {
  if (!existsSync(file)) return { ok: true, paused: false, stop: false };
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false, reason: `invalid control file: ${e.message}` };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid control file: expected an object' };
  }
  const c = raw;
  for (const k of ['paused', 'stop']) {
    if (c[k] !== undefined && typeof c[k] !== 'boolean') return { ok: false, reason: `invalid control file: '${k}' must be a boolean` };
  }
  if (c.steer !== undefined && typeof c.steer !== 'string') return { ok: false, reason: "invalid control file: 'steer' must be a string" };
  const result = { ok: true, paused: c.paused === true, stop: c.stop === true };
  if (typeof c.steer === 'string' && c.steer !== '') result.steer = c.steer;
  return result;
}

// Removes the steer note once it has been used, unless a newer note replaced it.
export function consumeSteer(file, note) {
  if (!existsSync(file)) return;
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

// Merges `update` into the control file with an atomic write (tmp + rename).
// Refuses a malformed existing file: it is already a stop and must not be silently cleared.
export function writeControl(file, update) {
  const cur = readControl(file);
  if (!cur.ok) return cur;
  const base = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...base, ...update }));
  renameSync(tmp, file);
  return { ok: true };
}
