import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const templatePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'test-harness.js');

test('templates/test-harness.js: runCommand runs a command and captures its exit status and output', async () => {
  const { runCommand } = await import(pathToFileURL(templatePath).href);
  const res = runCommand(process.execPath, ['-e', 'console.log("hi"); process.exit(3)']);
  assert.equal(res.status, 3);
  assert.match(res.stdout, /hi/);
});

test('templates/test-harness.js: httpRequest fetches a URL and returns its status and body text', async () => {
  const { httpRequest } = await import(pathToFileURL(templatePath).href);
  const { createServer } = await import('node:http');
  const server = createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise((resolve) => server.listen(0, () => resolve(undefined)));
  const address = server.address();
  const port = typeof address === 'string' ? 0 : address?.port;
  try {
    const res = await httpRequest(`http://localhost:${port}/`);
    assert.equal(res.status, 200);
    assert.equal(res.text, 'ok');
  } finally {
    server.close();
  }
});

test('templates/test-harness.js: re-exports node:assert as `assert`', async () => {
  const mod = await import(pathToFileURL(templatePath).href);
  assert.throws(() => mod.assert.equal(1, 2));
  assert.doesNotThrow(() => mod.assert.equal(1, 1));
});
