import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFormats } from './formats.js';
import { checkReadiness, dimensionStates } from './readiness.js';
import { bulletsBySection } from './spec-lint.js';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

// What the run is held to: declared formats, readiness by dimension, QA findings and done evidence.
// Read-only; everything comes from the specs and `runs/<runId>/`.
export function readRunDetails(repoDir, runId) {
  const specsDir = join(repoDir, 'specs');
  const files = existsSync(specsDir) ? readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort() : [];
  const formats = [];
  const specs = [];
  for (const f of files) {
    const text = readFileSync(join(specsDir, f), 'utf8');
    const spec = `specs/${f}`;
    for (const d of parseFormats(text).declared) formats.push({ spec, ...d });
    specs.push({ spec, dimensions: dimensionStates(bulletsBySection(text).get('dimensions') ?? []) });
  }
  const { ready, gaps } = checkReadiness(repoDir);

  const runDir = join(repoDir, 'runs', runId);
  const qa = [];
  const cycles = existsSync(runDir)
    ? readdirSync(runDir).map((d) => /^qa-(\d+)$/.exec(d)?.[1]).filter((n) => n !== undefined).map(Number).sort((a, b) => a - b)
    : [];
  for (const cycle of cycles) {
    const rec = readJson(join(runDir, `qa-${cycle}`, 'record.json'));
    if (!rec || typeof rec.status !== 'string') continue;
    const findings = readJson(join(runDir, `qa-${cycle}`, 'findings.json'));
    qa.push({ cycle, status: rec.status, ...(rec.reason ? { reason: rec.reason } : {}), findings: Array.isArray(findings) ? findings : [] });
  }

  const done = readJson(join(runDir, 'done.json'));
  return { formats, readiness: { ready, gaps: gaps.length, specs }, qa, done: done && typeof done === 'object' ? done : null };
}
