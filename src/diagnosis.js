/**
 * @typedef {{rootCause: string, evidence: string, fix: string, test: string, prevention: string}} Diagnosis
 */

export const DIAGNOSIS_FIELDS = ['rootCause', 'evidence', 'fix', 'test', 'prevention'];

/**
 * @param {unknown} d
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateDiagnosis(d) {
  if (typeof d !== 'object' || d === null) return { ok: false, errors: ['diagnosis must be an object'] };
  const o = /** @type {Record<string, unknown>} */ (d);
  const errors = DIAGNOSIS_FIELDS
    .filter((k) => typeof o[k] !== 'string' || o[k].trim() === '')
    .map((k) => `diagnosis.${k} must be a non-empty string`);
  return { ok: errors.length === 0, errors };
}

/**
 * The agent reports a diagnosis as a fenced ```diagnosis block holding JSON; the last valid one wins.
 * @param {string} transcript
 * @returns {Diagnosis | null}
 */
export function parseDiagnosis(transcript) {
  const blocks = [...transcript.matchAll(/```diagnosis\s*\n([\s\S]*?)\n```/g)];
  for (const m of blocks.reverse()) {
    try {
      const d = JSON.parse(m[1]);
      if (validateDiagnosis(d).ok) return /** @type {Diagnosis} */ (d);
    } catch {
      // malformed block: try the previous one
    }
  }
  return null;
}

/** Per-gate defaults for fix/test/prevention: a failure becomes a sign (prompt/spec/gate change), not a retry. */
const GATE_ADVICE = {
  scope: ['Keep changes inside allowedPaths, or widen allowedPaths deliberately in config.', 'Add a scope-gate test for the offending path.', 'State the allowed paths in the prompt or spec.'],
  'anti-stub': ['Replace the stub with a real implementation.', 'Add a test that fails on the stubbed behaviour.', 'Add a "no stubs" line to the prompt.'],
  formats: ['Make the output conform to the declared format.', 'Add a conformance case for the failing artifact.', 'Name the format and output path in the spec.'],
  tests: ['Fix the regression the tests show.', 'Add or tighten the test that should have caught it.', 'Run scoped tests after each change (prompt).'],
  types: ['Fix the type errors reported.', 'Add a type-level check for the failing contract.', 'Run the type check after each change (prompt).'],
  hardening: ['Strengthen the tests so mutants are killed.', 'Add a test for each surviving mutant.', 'Record the surviving mutants in the plan.'],
  'tests-only': ['Limit hardening changes to tests/.', 'Add a scope test for the offending path.', 'Say "tests only" in the prompt.'],
};

/**
 * Build a diagnosis for a non-ok step: harness-derived defaults, overridden field by field by the agent's block.
 * @param {{status: string, gates: {name: string, ok: boolean, detail?: string}[], transcript: string}} s
 * @returns {Diagnosis | null}
 */
export function diagnose({ status, gates, transcript }) {
  if (status === 'ok') return null;
  const bad = gates.find((g) => !g.ok);
  /** @type {Diagnosis} */
  let base;
  if (bad) {
    const [fix, test, prevention] = /** @type {Record<string, string[]>} */ (GATE_ADVICE)[bad.name] ?? [
      `Resolve the ${bad.name} gate failure.`, `Add a test covering the ${bad.name} gate.`, `Tighten the prompt, spec or gate for ${bad.name}.`,
    ];
    base = { rootCause: `gate ${bad.name} failed`, evidence: bad.detail ?? `gate ${bad.name} reported failure`, fix, test, prevention };
  } else if (status === 'over-budget') {
    base = {
      rootCause: 'wall-clock or iteration budget exhausted',
      evidence: 'wall-clock seconds or iteration count reached the run budget',
      fix: 'Raise the budget deliberately or split the plan item.',
      test: 'Add a budget-gate case for the exhausted cap.',
      prevention: 'Size wall-clock and iteration budgets for a live agent call and keep plan items small.',
    };
  } else {
    base = {
      rootCause: 'agent call exited non-zero',
      evidence: transcript.trim().split('\n').slice(-5).join('\n') || 'no transcript',
      fix: 'Read the transcript, fix the cause, then rerun the step.',
      test: 'Add a test or adapter fixture reproducing the failure.',
      prevention: 'Tune the prompt, spec or gate so the failure cannot recur silently.',
    };
  }
  const agent = parseDiagnosis(transcript);
  return agent ? { ...base, ...agent } : base;
}
