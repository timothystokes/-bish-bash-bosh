import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FORMATS, checkFormats } from '../src/formats.js';

/** @param {Record<string, string>} files */
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'asyncapi-'));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

/** @param {Record<string, unknown>} [over] */
const v3 = (over = {}) => ({
  asyncapi: '3.0.0',
  info: { title: 'Orders', version: '1.0.0' },
  channels: { orders: { address: 'orders', messages: { created: { payload: { $ref: '#/components/schemas/Order' } } } } },
  operations: { onOrderCreated: { action: 'receive', channel: { $ref: '#/channels/orders' } } },
  components: { schemas: { Order: { type: 'object', properties: { id: { type: 'string' } } } } },
  ...over,
});

/** @param {Record<string, unknown>} [over] */
const v2 = (over = {}) => ({
  asyncapi: '2.6.0',
  info: { title: 'Orders', version: '1.0.0' },
  channels: { orders: { subscribe: { operationId: 'onOrder', message: { payload: { type: 'object' } } } } },
  ...over,
});

const validate = (/** @type {string} */ name, /** @type {string} */ text) => {
  const dir = repo({ [name]: text });
  return FORMATS.asyncapi.validate(join(dir, name));
};

test('asyncapi is a registered format', () => {
  assert.ok(Object.hasOwn(FORMATS, 'asyncapi'));
});

test('valid AsyncAPI 3.0 and 2.6 documents pass', () => {
  assert.deepEqual(validate('a.json', JSON.stringify(v3())), []);
  assert.deepEqual(validate('b.json', JSON.stringify(v2())), []);
});

test('a YAML document passes', () => {
  assert.deepEqual(validate('a.yaml', 'asyncapi: 3.0.0\ninfo:\n  title: T\n  version: "1"\nchannels: {}\n'), []);
});

test('unparseable input is reported', () => {
  assert.match(validate('a.yaml', 'a: [unclosed').join('\n'), /invalid YAML\/JSON/);
  assert.match(validate('a.json', '[1]').join('\n'), /must be an object/);
});

test('a missing or unsupported asyncapi version is reported', () => {
  assert.match(validate('a.json', JSON.stringify({ info: {} })).join('\n'), /unsupported or missing asyncapi version/);
  assert.match(validate('a.json', JSON.stringify(v3({ asyncapi: '1.2.0' }))).join('\n'), /unsupported or missing asyncapi version/);
  assert.match(validate('a.json', JSON.stringify(v3({ asyncapi: 3 }))).join('\n'), /unsupported or missing asyncapi version/);
});

test('a document violating the official schema is reported', () => {
  const { info, ...rest } = v3();
  void info;
  assert.match(validate('a.json', JSON.stringify(rest)).join('\n'), /invalid AsyncAPI: .*info/);
  assert.match(validate('b.json', JSON.stringify(v3({ operations: { x: { action: 'explode', channel: { $ref: '#/channels/orders' } } } }))).join('\n'), /invalid AsyncAPI/);
});

test('an unresolved local $ref is reported', () => {
  const bad = v3({ operations: { x: { action: 'send', channel: { $ref: '#/channels/missing' } } } });
  assert.match(validate('a.json', JSON.stringify(bad)).join('\n'), /unresolved \$ref "#\/channels\/missing"/);
});

test('a repeated operationId within a 2.x document is reported', () => {
  const dup = v2({
    channels: {
      a: { subscribe: { operationId: 'same', message: { payload: {} } } },
      b: { publish: { operationId: 'same', message: { payload: {} } } },
    },
  });
  assert.match(validate('a.json', JSON.stringify(dup)).join('\n'), /duplicate operationId "same"/);
});

test('crossCheck flags an operation id defined in two documents', () => {
  const dir = repo({ 'a.json': JSON.stringify(v3()), 'b.json': JSON.stringify(v3()), 'c.json': JSON.stringify(v2()) });
  const problems = FORMATS.asyncapi.crossCheck([join(dir, 'a.json'), join(dir, 'b.json'), join(dir, 'c.json')]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /duplicate operationId "onOrderCreated"/);
});

test('checkFormats gates a declared asyncapi artifact', () => {
  const spec = (/** @type {string} */ p) => `# S\n\n## Requirements\n- Events follow ${p}.\n\n## Formats\n- asyncapi: ${p}\n`;
  const ok = repo({ 'specs/e.md': spec('specs/events.json'), 'specs/events.json': JSON.stringify(v3()) });
  assert.deepEqual(checkFormats(ok), []);
  const bad = repo({ 'specs/e.md': spec('specs/events.json'), 'specs/events.json': JSON.stringify({ asyncapi: '3.0.0' }) });
  assert.match(checkFormats(bad).join('\n'), /asyncapi artifact specs\/events\.json: invalid AsyncAPI/);
});
