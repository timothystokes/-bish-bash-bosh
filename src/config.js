import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

const schema = JSON.parse(
  readFileSync(new URL('./config.schema.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv.default({ allErrors: true });
const validate = ajv.compile(schema);

/**
 * Validate a harness config object against the config schema.
 * Adapter and model ids are opaque strings; the harness never names vendors.
 * @param {unknown} config
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateConfig(config) {
  const ok = validate(config);
  const errors = (validate.errors ?? []).map((e) => {
    const extra = e.params && 'missingProperty' in e.params ? ` (${e.params.missingProperty})` : '';
    return `${e.instancePath || '/'} ${e.message}${extra}`;
  });
  return { ok: Boolean(ok), errors };
}
