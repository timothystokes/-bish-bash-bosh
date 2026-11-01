import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readControl, consumeSteer } from '../src/control.js';

const ctlFile = () => join(mkdtempSync(join(tmpdir(), 'hodge-ctlf-')), 'control.json');

test('readControl: missing file means running with no note', () => {
  assert.deepEqual(readControl(ctlFile()), { ok: true, paused: false, stop: false });
});

test('readControl parses pause, stop and steer', () => {
  const f = ctlFile();
  writeFileSync(f, JSON.stringify({ paused: true, stop: true, steer: 'focus on parsing' }));
  assert.deepEqual(readControl(f), { ok: true, paused: true, stop: true, steer: 'focus on parsing' });
});

test('readControl fails closed on invalid JSON or wrong types', () => {
  const f = ctlFile();
  writeFileSync(f, '{nope');
  assert.equal(readControl(f).ok, false);
  writeFileSync(f, JSON.stringify({ paused: 'yes' }));
  assert.equal(readControl(f).ok, false);
  writeFileSync(f, JSON.stringify({ steer: 5 }));
  assert.equal(readControl(f).ok, false);
});

test('consumeSteer removes only the matching note and keeps other fields', () => {
  const f = ctlFile();
  writeFileSync(f, JSON.stringify({ paused: false, steer: 'a' }));
  consumeSteer(f, 'a');
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { paused: false });
  writeFileSync(f, JSON.stringify({ steer: 'newer' }));
  consumeSteer(f, 'a');
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).steer, 'newer');
});

test('writeControl merges updates atomically and preserves other keys', async () => {
  const { writeControl } = await import('../src/control.js');
  const { mkdtempSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const f = join(mkdtempSync(join(tmpdir(), 'hodge-wc-')), 'control.json');
  assert.deepEqual(writeControl(f, { paused: true }), { ok: true });
  assert.deepEqual(writeControl(f, { steer: 'focus' }), { ok: true });
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { paused: true, steer: 'focus' });
  assert.deepEqual(writeControl(f, { paused: false }), { ok: true });
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { paused: false, steer: 'focus' });
  assert.equal(existsSync(`${f}.tmp`), false);
});

test('writeControl refuses to overwrite a malformed control file', async () => {
  const { writeControl } = await import('../src/control.js');
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const f = join(mkdtempSync(join(tmpdir(), 'hodge-wc-')), 'control.json');
  writeFileSync(f, '{nope');
  const r = writeControl(f, { paused: false });
  assert.equal(r.ok, false);
  assert.equal(readFileSync(f, 'utf8'), '{nope');
});
