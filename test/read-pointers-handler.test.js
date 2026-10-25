import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handler } from '../src/read-pointers-handler.js';

test('handler rebuilds JSON-safe pointers from the mounted repo and its control.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-lambda-'));
  writeFileSync(join(dir, 'plan.md'), '- [ ] a\n');
  writeFileSync(join(dir, 'control.json'), JSON.stringify({ paused: true }));
  process.env.HODGE_REPO_DIR = dir;
  try {
    const p = await handler({ runId: 'r1' });
    assert.equal(p.status, 'new');
    assert.equal(p.paused, true);
    assert.equal(p.stop, false);
    assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
  } finally {
    delete process.env.HODGE_REPO_DIR;
  }
});
