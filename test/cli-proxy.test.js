import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, helpText } from '../src/cli.js';

const AWS = 'AKIAIOSFODNN7EXAMPLE';

/** @param {string[]} args */
async function runCli(args) {
  const ac = new AbortController();
  /** @type {string[]} */
  const outs = [];
  /** @type {string[]} */
  const errs = [];
  /** @type {(port: number) => void} */
  let gotPort = () => {};
  const portP = new Promise((r) => (gotPort = r));
  const done = main(args, {
    signal: ac.signal,
    stdout: (s) => {
      outs.push(s);
      try {
        gotPort(JSON.parse(s).port);
      } catch {}
    },
    stderr: (s) => errs.push(s),
  });
  return { ac, done, outs, errs, portP };
}

test('help documents hodgepodge proxy', () => {
  assert.match(helpText(), /hodgepodge proxy --upstream/);
});

test('hodgepodge proxy requires --upstream and rejects unknown args (exit 2)', async () => {
  /** @type {string[]} */
  const errs = [];
  assert.equal(await main(['proxy'], { stderr: (s) => errs.push(s) }), 2);
  assert.match(errs.join(''), /--upstream/);
  assert.equal(await main(['proxy', '--upstream', 'http://127.0.0.1:1', '--bogus', 'x'], { stderr: (s) => errs.push(s) }), 2);
  assert.equal(await main(['proxy', '--upstream', 'http://127.0.0.1:1', '--port', 'abc'], { stderr: (s) => errs.push(s) }), 2);
  assert.equal(await main(['proxy', '--upstream', 'not a url'], { stderr: (s) => errs.push(s) }), 2);
});

test('hodgepodge proxy prints its port, redacts, audits, meters, and stops on abort', async () => {
  /** @type {string[]} */
  const seen = [];
  const upstream = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen.push(b);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }));
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', () => r(undefined)));
  const upPort = /** @type {import('node:net').AddressInfo} */ (upstream.address()).port;
  const dir = mkdtempSync(join(tmpdir(), 'hodge-proxy-'));
  const audit = join(dir, 'audit.jsonl');
  const meter = join(dir, 'meter.jsonl');

  const cli = await runCli(['proxy', '--upstream', `http://127.0.0.1:${upPort}`, '--audit', audit, '--meter', meter]);
  const port = await cli.portP;
  assert.equal(typeof port, 'number');
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat`, { method: 'POST', body: `key ${AWS}` });
  assert.equal(res.status, 200);
  await res.text();
  assert.equal(seen[0].includes(AWS), false);
  assert.match(seen[0], /\[REDACTED:aws-access-key-id\]/);
  assert.equal(readFileSync(audit, 'utf8').includes(AWS), false);
  assert.match(readFileSync(audit, 'utf8'), /aws-access-key-id/);
  assert.match(readFileSync(meter, 'utf8'), /"tokens":5/);

  cli.ac.abort();
  assert.equal(await cli.done, 0);
  await new Promise((r) => upstream.close(() => r(undefined)));
});
