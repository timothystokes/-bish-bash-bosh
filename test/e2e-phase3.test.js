import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '..', 'bin', 'bish-bash-bosh');
const KEY = 'sk-' + 'a'.repeat(24);

test('phase 3 exit: bish-bash-bosh proxy (subprocess) redacts secrets, audits without values, and meters usage', async () => {
  /** @type {string[]} */
  const seen = [];
  const upstream = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen.push(b);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } }));
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', () => r(undefined)));
  const up = /** @type {import('node:net').AddressInfo} */ (upstream.address());

  const tmp = mkdtempSync(join(tmpdir(), 'bish-proxy-'));
  const audit = join(tmp, 'audit.jsonl');
  const meter = join(tmp, 'meter.jsonl');
  const child = spawn(process.execPath, [bin, 'proxy', '--upstream', `http://127.0.0.1:${up.port}`, '--audit', audit, '--meter', meter], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const port = await new Promise((resolve, reject) => {
      let buf = '';
      child.on('error', reject);
      child.on('exit', (c) => reject(new Error(`proxy exited early (${c})`)));
      child.stdout.on('data', (d) => {
        buf += d;
        const m = buf.match(/listening on port (\d+)/);
        if (m) resolve(Number(m[1]));
      });
    });

    const r = await fetch(`http://127.0.0.1:${port}/v1/chat`, { method: 'POST', body: JSON.stringify({ prompt: `key ${KEY}` }) });
    assert.equal(r.status, 200);
    assert.equal(seen.length, 1);
    assert.doesNotMatch(seen[0], new RegExp(KEY));
    assert.match(seen[0], /\[REDACTED:[\w-]+\]/);

    const auditText = readFileSync(audit, 'utf8');
    assert.ok(auditText.trim().length > 0);
    assert.doesNotMatch(auditText, new RegExp(KEY));
    const m = JSON.parse(readFileSync(meter, 'utf8').trim().split('\n')[0]);
    assert.equal(m.tokens, 42);
  } finally {
    const exited = new Promise((r) => child.once('exit', (code) => r(code)));
    child.kill('SIGTERM');
    assert.equal(await exited, 0);
    upstream.close();
  }
});
