import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFormats } from './formats.js';
import { checkReadiness, dimensionStates } from './readiness.js';
import { bulletsBySection } from './spec-lint.js';

/**
 * @typedef {import('./qa.js').Finding} Finding
 * @typedef {import('./done.js').DoneReport} DoneReport
 * @typedef {{spec: string, format: string, path: string, output?: string}} DeclaredFormat
 * @typedef {{spec: string, dimensions: Record<string, 'covered' | 'n/a' | 'gap' | 'missing'>}} SpecReadiness
 * @typedef {{cycle: number, status: string, reason?: string, findings: Finding[]}} QaCycleSummary
 * @typedef {{
 *   formats: DeclaredFormat[],
 *   readiness: {ready: boolean, gaps: number, specs: SpecReadiness[]},
 *   qa: QaCycleSummary[],
 *   done: DoneReport | null,
 * }} RunDetails
 */

/**
 * @param {string} path
 * @returns {unknown} parsed JSON, or undefined when missing or unreadable
 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * What the run is held to: declared formats, readiness by dimension, QA findings and done evidence.
 * Read-only; everything comes from the specs and `runs/<runId>/`.
 * @param {string} repoDir
 * @param {string} runId
 * @returns {RunDetails}
 */
export function readRunDetails(repoDir, runId) {
  const specsDir = join(repoDir, 'specs');
  const files = existsSync(specsDir) ? readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort() : [];
  /** @type {DeclaredFormat[]} */
  const formats = [];
  /** @type {SpecReadiness[]} */
  const specs = [];
  for (const f of files) {
    const text = readFileSync(join(specsDir, f), 'utf8');
    const spec = `specs/${f}`;
    for (const d of parseFormats(text).declared) formats.push({ spec, ...d });
    specs.push({ spec, dimensions: dimensionStates(bulletsBySection(text).get('dimensions') ?? []) });
  }
  const { ready, gaps } = checkReadiness(repoDir);

  const runDir = join(repoDir, 'runs', runId);
  /** @type {QaCycleSummary[]} */
  const qa = [];
  const cycles = existsSync(runDir)
    ? readdirSync(runDir).map((d) => /^qa-(\d+)$/.exec(d)?.[1]).filter((n) => n !== undefined).map(Number).sort((a, b) => a - b)
    : [];
  for (const cycle of cycles) {
    const rec = /** @type {{status?: string, reason?: string} | undefined} */ (readJson(join(runDir, `qa-${cycle}`, 'record.json')));
    if (!rec || typeof rec.status !== 'string') continue;
    const findings = readJson(join(runDir, `qa-${cycle}`, 'findings.json'));
    qa.push({ cycle, status: rec.status, ...(rec.reason ? { reason: rec.reason } : {}), findings: Array.isArray(findings) ? findings : [] });
  }

  const done = /** @type {DoneReport | undefined} */ (readJson(join(runDir, 'done.json')));
  return { formats, readiness: { ready, gaps: gaps.length, specs }, qa, done: done && typeof done === 'object' ? done : null };
}
