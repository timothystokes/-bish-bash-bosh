import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FORMATS, checkFormats } from '../src/formats.js';

/** @param {Record<string, string>} files */
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'oas-'));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

/** @param {Record<string, unknown>} [over] */
const doc = (over = {}) => ({
  openapi: '3.1.0',
  info: { title: 'Orders', version: '1.0.0' },
  paths: {
    '/orders': {
      get: { operationId: 'listOrders', responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } } } },
    },
  },
  components: { schemas: { Order: { type: 'object', properties: { id: { type: 'string' } } } } },
  ...over,
});

const validate = (/** @type {string} */ name, /** @type {string} */ text) => {
  const dir = repo({ [name]: text });
  return FORMATS.openapi.validate(join(dir, name));
};

test('openapi is a registered format', () => {
  assert.ok(Object.hasOwn(FORMATS, 'openapi'));
});

test('a valid OpenAPI 3.1 JSON document passes', () => {
  assert.deepEqual(validate('api.json', JSON.stringify(doc())), []);
});

test('a valid OpenAPI 3.0 YAML document passes', () => {
  const yaml = `openapi: 3.0.3
info:
  title: Orders
  version: 1.0.0
paths:
  /orders:
    get:
      operationId: listOrders
      responses:
        '200':
          description: ok
`;
  assert.deepEqual(validate('api.yaml', yaml), []);
});

test('unparseable content is a problem', () => {
  const p = validate('api.json', 'openapi: [unclosed');
  assert.ok(p.some((x) => /invalid (YAML|JSON)/.test(x)));
});

test('a non-object document is a problem', () => {
  assert.ok(validate('api.yaml', '- a\n- b\n').some((x) => /must be an object/.test(x)));
});

test('a missing or unsupported openapi version is a problem', () => {
  assert.ok(validate('a.json', JSON.stringify({ info: { title: 't', version: '1' }, paths: {} })).some((x) => /openapi version/.test(x)));
  assert.ok(validate('b.json', JSON.stringify(doc({ openapi: '2.0' }))).some((x) => /openapi version/.test(x)));
});

test('a schema violation names the location', () => {
  const bad = doc();
  delete (/** @type {Record<string, unknown>} */ (bad)).info;
  const p = validate('api.json', JSON.stringify(bad));
  assert.ok(p.some((x) => /info/.test(x)), p.join('; '));
});

test('an unresolved local $ref is a problem', () => {
  const p = validate('api.json', JSON.stringify(doc({ components: {} })));
  assert.ok(p.some((x) => /unresolved \$ref "#\/components\/schemas\/Order"/.test(x)), p.join('; '));
});

test('duplicate operationId in one document is a problem', () => {
  const d = doc();
  /** @type {any} */ (d).paths['/orders'].post = { operationId: 'listOrders', responses: { 201: { description: 'made' } } };
  assert.ok(validate('api.json', JSON.stringify(d)).some((x) => /duplicate operationId "listOrders"/.test(x)));
});

test('crossCheck flags an operationId defined in two documents', () => {
  const dir = repo({ 'a.json': JSON.stringify(doc()), 'b.json': JSON.stringify(doc()) });
  const p = FORMATS.openapi.crossCheck([join(dir, 'a.json'), join(dir, 'b.json')]);
  assert.equal(p.length, 1);
  assert.match(p[0], /duplicate operationId "listOrders"/);
});

test('crossCheck passes for distinct operationIds', () => {
  const other = doc();
  /** @type {any} */ (other).paths['/orders'].get.operationId = 'fetchOrders';
  const dir = repo({ 'a.json': JSON.stringify(doc()), 'b.json': JSON.stringify(other) });
  assert.deepEqual(FORMATS.openapi.crossCheck([join(dir, 'a.json'), join(dir, 'b.json')]), []);
});

test('checkFormats accepts a declared openapi artifact and reports an invalid one', () => {
  const spec = `# Spec: Orders
Implementation: none

## Purpose
Orders.

## Requirements
- R-orders-1: The API must match \`specs/api/orders.json\`.

## Formats
- openapi: specs/api/orders.json

## Out of scope
- Billing.
`;
  assert.deepEqual(checkFormats(repo({ 'specs/orders.md': spec, 'specs/api/orders.json': JSON.stringify(doc()) })), []);
  const gaps = checkFormats(repo({ 'specs/orders.md': spec, 'specs/api/orders.json': JSON.stringify(doc({ components: {} })) }));
  assert.ok(gaps.some((g) => /openapi artifact specs\/api\/orders\.json/.test(g) && /unresolved \$ref/.test(g)), gaps.join('; '));
});
