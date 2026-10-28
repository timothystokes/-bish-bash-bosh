import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

// One record of what was sent and what came back, instead of a separate prompt file that is
// written once and never touched again: `Prompt:` then `Response:`, so the run's artifact dir
// holds a single readable log per call.
export function formatTranscript(prompt, transcript) {
  return `Prompt:\n${prompt.trimEnd()}\n\nResponse:\n${transcript.trimEnd()}\n`;
}

// Check a value has the common adapter result shape.
export function validateAdapterResult(r) {
  const errors = [];
  if (typeof r !== 'object' || r === null) return { ok: false, errors: ['result must be an object'] };
  const o = r;
  if (!Number.isInteger(o.exitStatus)) errors.push('exitStatus must be an integer');
  if (typeof o.transcript !== 'string') errors.push('transcript must be a string');
  if (!Array.isArray(o.changedFiles) || o.changedFiles.some((f) => typeof f !== 'string')) {
    errors.push('changedFiles must be an array of strings');
  }
  return { ok: errors.length === 0, errors };
}

// Scripted fake agent for contract tests; performs no network or process calls.
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
