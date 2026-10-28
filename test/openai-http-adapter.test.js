import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenAiHttpAdapter, parseFileBlocks } from '../src/adapters/openai-http.js';
import { defaultRegistry } from '../src/adapters/index.js';
import { adapterContract } from './helpers/adapter-contract.js';

/**
 * Local fake OpenAI-compatible server. `reply` builds the response per request.
 * @param {(req: {headers: import('node:http').IncomingHttpHeaders, body: any}) => {status?: number, delayMs?: number, json: any}} reply
 */
async function startServer(reply) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const r = reply({ headers: req.headers, body: raw ? JSON.parse(raw) : {} });
      setTimeout(() => {
        res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(r.json));
      }, r.delayMs ?? 0);
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { baseUrl: `http://127.0.0.1:${port}/v1`, close: () => server.close() };
}

/** @param {Record<string, string>} writes @param {string} text */
const blocks = (text, writes) =>
  text + '\n' + Object.entries(writes).map(([p, c]) => `<<<FILE ${p}>>>\n${c}\n<<<END>>>`).join('\n');

/** @param {string} content */
const completion = (content) => ({ choices: [{ message: { role: 'assistant', content } }] });

/** @type {(() => void)[]} */
const closers = [];
test.after(() => closers.forEach((c) => c()));

const make = (f) => {
  // Contract adapters are built synchronously, so the server starts lazily on first run.
  /** @type {Promise<{baseUrl: string, close: () => void}> | undefined} */
  let started;
  return {
    async run(req) {
      started ??= startServer(() =>
        f.exitStatus !== 0
          ? { status: 500, json: { error: { message: f.transcript } } }
          : {
              json: completion(blocks(f.transcript, f.writes)),
            },
      );
      const s = await started;
      closers.push(s.close);
      return createOpenAiHttpAdapter({ model: 'm', baseUrl: s.baseUrl }).run(req);
    },
  };
};

adapterContract('openai-http adapter', make);

test('parseFileBlocks separates files from commentary', () => {
  const p = parseFileBlocks('hello\n<<<FILE a/b.js>>>\nline1\nline2\n<<<END>>>\nbye');
  assert.deepEqual(p.files, { 'a/b.js': 'line1\nline2' });
  assert.equal(p.transcript, 'hello\n\nbye');
});

test('sends bearer key from the named env var, model and prompt', async () => {
  /** @type {any} */
  let seen;
  const s = await startServer((r) => {
    seen = r;
    return { json: completion('ok') };
  });
  const cwd = mkdtempSync(join(tmpdir(), 'hodge-http-'));
  try {
    const a = createOpenAiHttpAdapter({ model: 'mm', baseUrl: s.baseUrl, apiKeyEnv: 'K', env: { K: 'secret' } });
    const r = await a.run({ prompt: 'do it', cwd, limits: {} });
    assert.equal(r.exitStatus, 0);
    assert.equal(seen.headers.authorization, 'Bearer secret');
    assert.equal(seen.body.model, 'mm');
    assert.equal(seen.body.messages.at(-1).content, 'do it');
  } finally {
    s.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('paths escaping cwd are rejected and not written', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hodge-http-'));
  const outside = join(cwd, '..', 'hodge-escape.txt');
  const s = await startServer(() => ({
    json: completion(blocks('x', { '../hodge-escape.txt': 'bad', '/tmp/hodge-abs.txt': 'bad', 'ok.txt': 'fine' })),
  }));
  try {
    const r = await createOpenAiHttpAdapter({ model: 'm', baseUrl: s.baseUrl }).run({ prompt: 'p', cwd, limits: {} });
    assert.notEqual(r.exitStatus, 0);
    assert.deepEqual(r.changedFiles, ['ok.txt']);
    assert.equal(existsSync(outside), false);
    assert.equal(existsSync('/tmp/hodge-abs.txt'), false);
  } finally {
    s.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('wall-clock limit aborts the request with exit 124', async () => {
  const s = await startServer(() => ({ delayMs: 2000, json: completion('late') }));
  const cwd = mkdtempSync(join(tmpdir(), 'hodge-http-'));
  try {
    const r = await createOpenAiHttpAdapter({ model: 'm', baseUrl: s.baseUrl }).run({ prompt: 'p', cwd, limits: { maxWallClockSeconds: 0.2 } });
    assert.equal(r.exitStatus, 124);
  } finally {
    s.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('unreachable server yields exit 127, not a throw', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hodge-http-'));
  try {
    const r = await createOpenAiHttpAdapter({ model: 'm', baseUrl: 'http://127.0.0.1:1/v1' }).run({ prompt: 'p', cwd, limits: {} });
    assert.equal(r.exitStatus, 127);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('registered in defaultRegistry as openai-http', () => {
  assert.equal(typeof defaultRegistry['openai-http'], 'function');
});
