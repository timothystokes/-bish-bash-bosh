import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { parseFormats, checkFormats, checkFormatGate, FORMATS } from '../src/formats.js';
import { checkReadiness } from '../src/readiness.js';

const spec = (/** @type {string} */ formats, req = 'R-order-1: An order must conform to `specs/schemas/order.json`.') => `# Spec: Order
Implementation: none

## Purpose
Orders.

## Requirements
- ${req}
- R-order-2: An order must have an id.
- R-order-3: An order must reject a negative total.

${formats}
## Out of scope
- Billing.
`;

/** @param {Record<string, string>} files */
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'fmt-'));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

const schema = JSON.stringify({ $id: 'https://x/order', type: 'object' });
const declared = '## Formats\n- json-schema: specs/schemas/order.json\n\n';

test('parseFormats reads `- <format>: <path>` bullets under ## Formats', () => {
  const r = parseFormats(spec('## Formats\n- json-schema: specs/schemas/order.json\n- gherkin: specs/x.feature\n\n'));
  assert.deepEqual(r.declared, [
    { format: 'json-schema', path: 'specs/schemas/order.json' },
    { format: 'gherkin', path: 'specs/x.feature' },
  ]);
  assert.deepEqual(r.malformed, []);
});

test('parseFormats reports a bullet that is not `<format>: <path>`', () => {
  const r = parseFormats(spec('## Formats\n- json-schema\n\n'));
  assert.deepEqual(r.declared, []);
  assert.deepEqual(r.malformed, ['json-schema']);
});

test('a spec with no ## Formats section declares nothing', () => {
  assert.deepEqual(parseFormats(spec('')), { declared: [], malformed: [] });
});

test('a ## Formats heading inside a code fence is ignored', () => {
  const r = parseFormats(spec('```\n## Formats\n- json-schema: a.json\n```\n'));
  assert.deepEqual(r.declared, []);
});

test('registry exposes validate and crossCheck per format', () => {
  for (const f of Object.values(FORMATS)) {
    assert.equal(typeof f.validate, 'function');
    assert.equal(typeof f.crossCheck, 'function');
  }
  assert.ok('json-schema' in FORMATS);
});

test('a declared, valid, requirement-referenced artifact has no gaps', () => {
  const dir = repo({ 'specs/order.md': spec(declared), 'specs/schemas/order.json': schema });
  assert.deepEqual(checkFormats(dir), []);
});

test('an unknown format name is a gap naming spec, format and path', () => {
  const dir = repo({ 'specs/order.md': spec('## Formats\n- klingon: specs/a.kl\n\n') });
  const gaps = checkFormats(dir);
  assert.ok(gaps.some((g) => /specs\/order\.md/.test(g) && /klingon/.test(g) && /unknown format/.test(g) && /specs\/a\.kl/.test(g)), gaps.join('|'));
});

test('a missing artifact is a gap', () => {
  const dir = repo({ 'specs/order.md': spec(declared) });
  const gaps = checkFormats(dir);
  assert.ok(gaps.some((g) => /specs\/order\.md/.test(g) && /json-schema/.test(g) && /specs\/schemas\/order\.json/.test(g) && /missing/.test(g)), gaps.join('|'));
});

test('an unparseable artifact is a gap', () => {
  const dir = repo({ 'specs/order.md': spec(declared), 'specs/schemas/order.json': '{nope' });
  const gaps = checkFormats(dir);
  assert.ok(gaps.some((g) => /json-schema/.test(g) && /specs\/schemas\/order\.json/.test(g) && /invalid/.test(g)), gaps.join('|'));
});

test('a JSON value that is not a schema is a gap', () => {
  const dir = repo({ 'specs/order.md': spec(declared), 'specs/schemas/order.json': '[1]' });
  assert.ok(checkFormats(dir).some((g) => /invalid/.test(g)));
});

test('an artifact outside the repo is a gap', () => {
  const dir = repo({ 'specs/order.md': spec('## Formats\n- json-schema: ../escape.json\n\n') });
  assert.ok(checkFormats(dir).some((g) => /outside the repo/.test(g)));
});

test('a malformed bullet is a gap', () => {
  const dir = repo({ 'specs/order.md': spec('## Formats\n- json-schema\n\n') });
  assert.ok(checkFormats(dir).some((g) => /malformed/.test(g) && /specs\/order\.md/.test(g)));
});

test('an artifact referenced by no requirement is a gap', () => {
  const dir = repo({
    'specs/order.md': spec(declared, 'R-order-1: An order must have a total.'),
    'specs/schemas/order.json': schema,
  });
  assert.ok(checkFormats(dir).some((g) => /not referenced by any requirement/.test(g) && /order\.json/.test(g)));
});

test('conflicting $id across json-schema artifacts is a cross-file gap', () => {
  const other = '# Spec: Cart\nImplementation: none\n\n## Requirements\n- R-cart-1: A cart must conform to `specs/schemas/cart.json`.\n\n## Formats\n- json-schema: specs/schemas/cart.json\n\n## Out of scope\n- x\n';
  const dir = repo({
    'specs/order.md': spec(declared),
    'specs/cart.md': other,
    'specs/schemas/order.json': schema,
    'specs/schemas/cart.json': schema,
  });
  assert.ok(checkFormats(dir).some((g) => /duplicate \$id/.test(g) && /order\.json/.test(g) && /cart\.json/.test(g)));
});

test('readiness includes format gaps', () => {
  const dir = repo({ 'specs/order.md': spec(declared) });
  assert.ok(checkReadiness(dir).gaps.some((g) => /json-schema/.test(g) && /missing/.test(g)));
});

const withOutput = '## Formats\n- json-schema: specs/schemas/order.json -> out/order.json\n\n';
const strictSchema = JSON.stringify({ $id: 'https://x/order', type: 'object', required: ['total'], properties: { total: { type: 'number', minimum: 0 } } });
const orderSpec = () => spec(withOutput, 'R-order-1: An order must conform to `specs/schemas/order.json`.');

test('parseFormats reads an optional `-> <output path>`', () => {
  const r = parseFormats(spec(withOutput));
  assert.deepEqual(r.declared, [{ format: 'json-schema', path: 'specs/schemas/order.json', output: 'out/order.json' }]);
});

test('a JSON value that breaks the schema meta-schema is a gap', () => {
  const dir = repo({ 'specs/order.md': spec(declared), 'specs/schemas/order.json': JSON.stringify({ type: 'nonsense' }) });
  assert.ok(checkFormats(dir).some((g) => /invalid/.test(g) && /order\.json/.test(g)));
});

test('a $ref that resolves in another declared schema is fine', () => {
  const cart = '# Spec: Cart\nImplementation: none\n\n## Requirements\n- R-cart-1: A cart must conform to `specs/schemas/cart.json`.\n\n## Formats\n- json-schema: specs/schemas/cart.json\n\n## Out of scope\n- x\n';
  const dir = repo({
    'specs/order.md': spec(declared),
    'specs/cart.md': cart,
    'specs/schemas/order.json': schema,
    'specs/schemas/cart.json': JSON.stringify({ $id: 'https://x/cart', type: 'object', properties: { order: { $ref: 'https://x/order' } } }),
  });
  assert.deepEqual(checkFormats(dir), []);
});

test('an unresolved $ref is a cross-file gap', () => {
  const dir = repo({
    'specs/order.md': spec(declared),
    'specs/schemas/order.json': JSON.stringify({ $id: 'https://x/order', properties: { a: { $ref: 'https://x/missing' } } }),
  });
  assert.ok(checkFormats(dir).some((g) => /unresolved \$ref/.test(g) && /missing/.test(g)));
});

test('output that conforms to the declared schema passes', () => {
  const dir = repo({ 'specs/order.md': orderSpec(), 'specs/schemas/order.json': strictSchema, 'out/order.json': '{"total": 3}' });
  assert.deepEqual(checkFormats(dir), []);
});

test('output that violates the declared schema is a gap naming the path', () => {
  const dir = repo({ 'specs/order.md': orderSpec(), 'specs/schemas/order.json': strictSchema, 'out/order.json': '{"total": -1}' });
  assert.ok(checkFormats(dir).some((g) => /out\/order\.json/.test(g) && /minimum|>= 0/.test(g)));
});

test('output that is not JSON is a gap', () => {
  const dir = repo({ 'specs/order.md': orderSpec(), 'specs/schemas/order.json': strictSchema, 'out/order.json': '{nope' });
  assert.ok(checkFormats(dir).some((g) => /out\/order\.json/.test(g) && /invalid JSON/.test(g)));
});

test('output not yet produced is skipped', () => {
  const dir = repo({ 'specs/order.md': orderSpec(), 'specs/schemas/order.json': strictSchema });
  assert.deepEqual(checkFormats(dir), []);
});

test('an output path outside the repo is a gap', () => {
  const dir = repo({
    'specs/order.md': spec('## Formats\n- json-schema: specs/schemas/order.json -> ../out.json\n\n'),
    'specs/schemas/order.json': strictSchema,
  });
  assert.ok(checkFormats(dir).some((g) => /output/.test(g) && /outside the repo/.test(g)));
});

test('checkFormatGate passes with no formats and fails on a nonconforming output', () => {
  assert.equal(checkFormatGate(repo({ 'specs/a.md': '# Spec: A\n' })).ok, true);
  const dir = repo({ 'specs/order.md': orderSpec(), 'specs/schemas/order.json': strictSchema, 'out/order.json': '{}' });
  const g = checkFormatGate(dir);
  assert.equal(g.ok, false);
  assert.match(g.reason ?? '', /out\/order\.json/);
});
