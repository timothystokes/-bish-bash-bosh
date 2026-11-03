import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_RULES, redactSecrets, createSecretProxy, readProxyUsage } from '../src/secret-proxy.js';

const AWS = 'AKIAIOSFODNN7EXAMPLE';
const GH = 'ghp_' + 'a'.repeat(36);

test('redactSecrets replaces matches with [REDACTED:rule-id] and reports rules', () => {
  const r = redactSecrets(`key ${AWS} and token ${GH}`, DEFAULT_RULES);
  assert.equal(r.text.includes(AWS), false);
  assert.equal(r.text.includes(GH), false);
  assert.match(r.text, /\[REDACTED:aws-access-key-id\]/);
  assert.match(r.text, /\[REDACTED:github-token\]/);
  assert.deepEqual(r.findings.map((f) => f.rule).sort(), ['aws-access-key-id', 'github-token']);
});

test('redactSecrets catches private key blocks and bearer tokens, leaves clean text', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----';
  const r = redactSecrets(`x ${pem} y Authorization: Bearer abcdefghij1234567890`, DEFAULT_RULES);
  assert.match(r.text, /\[REDACTED:private-key\]/);
  assert.match(r.text, /\[REDACTED:bearer-token\]/);
  const clean = redactSecrets('nothing secret here', DEFAULT_RULES);
  assert.equal(clean.text, 'nothing secret here');
  assert.deepEqual(clean.findings, []);
});

test('redactSecrets accepts custom rules and counts repeats', () => {
  const r = redactSecrets('zz-1 zz-2', [{ id: 'zz', pattern: 'zz-\\d' }]);
  assert.equal(r.text, '[REDACTED:zz] [REDACTED:zz]');
  assert.equal(r.findings[0].count, 2);
});

/** @param {(body: string, headers: any) => {status?: number, body: string}} handler */
async function startUpstream(handler) {
  /** @type {{body: string, headers: any}[]} */
  const seen = [];
  const server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen.push({ body: b, headers: req.headers });
      const out = handler(b, req.headers);
      res.statusCode = out.status ?? 200;
      res.end(out.body);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { url: `http://127.0.0.1:${addr.port}`, seen, close: () => server.close() };
}

async function startProxy(/** @type {any} */ opts) {
  const proxy = createSecretProxy(opts);
  const port = await proxy.listen(0);
  return { proxy, url: `http://127.0.0.1:${port}` };
}

test('proxy redacts the request before forwarding and the response before returning', async () => {
  const up = await startUpstream(() => ({ body: `echo ${GH}` }));
  const auditFile = join(mkdtempSync(join(tmpdir(), 'bish-proxy-')), 'audit.jsonl');
  const { proxy, url } = await startProxy({ upstream: up.url, auditFile });
  try {
    const res = await fetch(`${url}/v1/chat`, { method: 'POST', body: `use ${AWS}` });
    assert.equal(res.status, 200);
    assert.equal(up.seen[0].body, 'use [REDACTED:aws-access-key-id]');
    assert.equal(await res.text(), 'echo [REDACTED:github-token]');
    const lines = readFileSync(auditFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((l) => l.direction), ['request', 'response']);
    assert.equal(lines[0].findings[0].rule, 'aws-access-key-id');
    assert.equal(readFileSync(auditFile, 'utf8').includes(AWS), false);
    assert.equal(readFileSync(auditFile, 'utf8').includes(GH), false);
  } finally {
    await proxy.close();
    up.close();
  }
});

test('proxy forwards method, path and query', async () => {
  const up = await startUpstream((_b, _h) => ({ body: 'ok' }));
  const { proxy, url } = await startProxy({ upstream: up.url });
  try {
    await fetch(`${url}/a/b?x=1`, { method: 'POST', body: 'hi' });
    assert.equal(up.seen.length, 1);
  } finally {
    await proxy.close();
    up.close();
  }
});

test('a request over the inspection limit is rejected and never forwarded', async () => {
  const up = await startUpstream(() => ({ body: 'ok' }));
  const auditFile = join(mkdtempSync(join(tmpdir(), 'bish-proxy-')), 'audit.jsonl');
  const { proxy, url } = await startProxy({ upstream: up.url, maxBodyBytes: 10, auditFile });
  try {
    const res = await fetch(`${url}/x`, { method: 'POST', body: 'x'.repeat(100) });
    assert.equal(res.status, 413);
    assert.equal(up.seen.length, 0);
    const line = JSON.parse(readFileSync(auditFile, 'utf8').trim());
    assert.equal(line.blocked, 'too-large');
  } finally {
    await proxy.close();
    up.close();
  }
});

test('a response over the inspection limit is withheld', async () => {
  const up = await startUpstream(() => ({ body: 'y'.repeat(100) }));
  const { proxy, url } = await startProxy({ upstream: up.url, maxBodyBytes: 50 });
  try {
    const res = await fetch(`${url}/x`, { method: 'POST', body: 'small' });
    assert.equal(res.status, 502);
    assert.equal((await res.text()).includes('yyyy'), false);
  } finally {
    await proxy.close();
    up.close();
  }
});

test('an unreachable upstream yields 502 and an audit entry, no crash', async () => {
  const auditFile = join(mkdtempSync(join(tmpdir(), 'bish-proxy-')), 'audit.jsonl');
  const { proxy, url } = await startProxy({ upstream: 'http://127.0.0.1:1', auditFile });
  try {
    const res = await fetch(`${url}/x`, { method: 'POST', body: 'hi' });
    assert.equal(res.status, 502);
    assert.equal(JSON.parse(readFileSync(auditFile, 'utf8').trim().split('\n').pop() ?? '').blocked, 'upstream-error');
  } finally {
    await proxy.close();
  }
});

test('if the audit log cannot be written the request is not forwarded (fail closed)', async () => {
  const up = await startUpstream(() => ({ body: 'ok' }));
  const bad = join(mkdtempSync(join(tmpdir(), 'bish-proxy-')), 'no-such-dir', 'audit.jsonl');
  const { proxy, url } = await startProxy({ upstream: up.url, auditFile: bad });
  try {
    const res = await fetch(`${url}/x`, { method: 'POST', body: 'hi' });
    assert.equal(res.status, 502);
    assert.equal(up.seen.length, 0);
    assert.equal(existsSync(bad), false);
  } finally {
    await proxy.close();
    up.close();
  }
});

test('proxy meters token usage from OpenAI and Anthropic shaped responses', async () => {
  const bodies = [
    JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    JSON.stringify({ usage: { input_tokens: 7, output_tokens: 3 } }),
    'not json',
    JSON.stringify({ choices: [] }),
  ];
  const up = await startUpstream(() => ({ body: /** @type {string} */ (bodies.shift()) }));
  const meterFile = join(mkdtempSync(join(tmpdir(), 'bish-proxy-')), 'meter.jsonl');
  const { proxy, url } = await startProxy({
    upstream: up.url,
    meterFile,
    rates: { inputPerMTok: 1000000, outputPerMTok: 2000000 },
  });
  try {
    for (let i = 0; i < 4; i++) await (await fetch(`${url}/v1/chat`, { method: 'POST', body: 'hi' })).text();
    assert.deepEqual(readProxyUsage(meterFile), { tokens: 25, cost: 10 + 10 + 7 + 6, requests: 2 });
  } finally {
    await proxy.close();
    up.close();
  }
});

test('proxy without rates meters tokens at zero cost; missing meter file reads as zero', async () => {
  const up = await startUpstream(() => ({ body: JSON.stringify({ usage: { total_tokens: 9 } }) }));
  const meterFile = join(mkdtempSync(join(tmpdir(), 'bish-proxy-')), 'meter.jsonl');
  assert.deepEqual(readProxyUsage(meterFile), { tokens: 0, cost: 0, requests: 0 });
  const { proxy, url } = await startProxy({ upstream: up.url, meterFile });
  try {
    await (await fetch(`${url}/x`, { method: 'POST', body: 'hi' })).text();
    assert.deepEqual(readProxyUsage(meterFile), { tokens: 9, cost: 0, requests: 1 });
  } finally {
    await proxy.close();
    up.close();
  }
});

test('proxy blocks the response when the meter file is unwritable', async () => {
  const up = await startUpstream(() => ({ body: JSON.stringify({ usage: { total_tokens: 9 } }) }));
  const dir = mkdtempSync(join(tmpdir(), 'bish-proxy-'));
  const { proxy, url } = await startProxy({ upstream: up.url, meterFile: join(dir, 'no', 'such', 'm.jsonl') });
  try {
    const res = await fetch(`${url}/x`, { method: 'POST', body: 'hi' });
    assert.equal(res.status, 502);
    assert.equal((await res.text()).includes('total_tokens'), false);
  } finally {
    await proxy.close();
    up.close();
  }
});
