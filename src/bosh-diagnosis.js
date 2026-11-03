
// Shape shared by any iteration record's optional `diagnosis` field (see bosh-run-record.js):
// root cause, evidence, fix, test and prevention, each a non-empty string. Nothing in the live
// CLI writes a diagnosis any more (that was the old build loop's job); this validator remains
// because `validateRunRecord` still accepts and checks one if a record happens to carry it.
export const DIAGNOSIS_FIELDS = ['rootCause', 'evidence', 'fix', 'test', 'prevention'];

export function validateDiagnosis(d) {
  if (typeof d !== 'object' || d === null) return { ok: false, errors: ['diagnosis must be an object'] };
  const o = d;
  const errors = DIAGNOSIS_FIELDS
    .filter((k) => typeof o[k] !== 'string' || o[k].trim() === '')
    .map((k) => `diagnosis.${k} must be a non-empty string`);
  return { ok: errors.length === 0, errors };
}
