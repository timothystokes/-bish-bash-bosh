import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateDiagnosis } from './podge-diagnosis.js';
import { formatTranscript } from './adapter.js';

const STATUSES = ['ok', 'failed', 'gated'];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function validateRunRecord(r) {
  const errors = [];
  if (typeof r !== 'object' || r === null) return { ok: false, errors: ['record must be an object'] };
  const o = r;
  if (!STATUSES.includes(o.status)) errors.push(`status must be one of ${STATUSES.join(', ')}`);
  if (typeof o.usage !== 'object' || o.usage === null || !isNum(o.usage.seconds)) {
    errors.push('usage.seconds must be a non-negative number');
  }
  if (!Array.isArray(o.changedFiles) || o.changedFiles.some((f) => typeof f !== 'string')) {
    errors.push('changedFiles must be an array of strings');
  }
  if (
    !Array.isArray(o.gates) ||
    o.gates.some((g) => typeof g !== 'object' || g === null || typeof g.name !== 'string' || typeof g.ok !== 'boolean')
  ) {
    errors.push('gates must be an array of {name, ok}');
  }
  for (const k of ['prompt', 'transcript', 'diff']) {
    if (typeof o[k] !== 'string') errors.push(`${k} must be a string`);
  }
  if (!('test' in o)) errors.push('test is required');
  if (o.diagnosis !== undefined) errors.push(...validateDiagnosis(o.diagnosis).errors);
  return { ok: errors.length === 0, errors };
}

function checkIds(runId, iteration) {
  if (typeof runId !== 'string' || !SAFE_ID.test(runId)) throw new Error(`invalid runId: ${runId}`);
  if (!Number.isInteger(iteration) || iteration < 1) throw new Error(`invalid iteration: ${iteration}`);
}

export function iterationDir(repoDir, runId, iteration) {
  checkIds(runId, iteration);
  return join(repoDir, '.hodgepodge', 'runs', runId, 'iterations', String(iteration).padStart(3, '0'));
}

// Write one iteration record atomically (temp dir then rename); never overwrites.
export function writeIterationRecord(repoDir, runId, iteration, record) {
  const v = validateRunRecord(record);
  if (!v.ok) throw new Error(`invalid run record: ${v.errors.join('; ')}`);
  const dir = iterationDir(repoDir, runId, iteration);
  if (existsSync(dir)) throw new Error(`iteration record exists: ${dir}`);
  const parent = join(dir, '..');
  mkdirSync(parent, { recursive: true });
  const tmp = mkdtempSync(join(parent, '.tmp-'));
  try {
    writeFileSync(join(tmp, 'transcript'), formatTranscript(record.prompt, record.transcript));
    writeFileSync(join(tmp, 'diff'), record.diff);
    writeFileSync(join(tmp, 'test.json'), JSON.stringify(record.test, null, 2));
    writeFileSync(join(tmp, 'usage.json'), JSON.stringify(record.usage, null, 2));
    if (record.diagnosis) writeFileSync(join(tmp, 'diagnosis.json'), JSON.stringify(record.diagnosis, null, 2));
    const meta = { iteration, status: record.status, changedFiles: record.changedFiles, gates: record.gates };
    writeFileSync(join(tmp, 'record.json'), JSON.stringify(meta, null, 2));
    renameSync(tmp, dir);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return dir;
}
