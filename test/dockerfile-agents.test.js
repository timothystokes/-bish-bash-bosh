import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIS = ['copilot', 'claude', 'codex'];

test('Dockerfile.agents derives from the base image and installs each agent CLI', () => {
  const text = readFileSync(join(root, 'Dockerfile.agents'), 'utf8');
  assert.match(text, /^ARG BASE_IMAGE=hodgepodge:dev$/m);
  assert.match(text, /^FROM \$\{BASE_IMAGE\}$/m);
  assert.match(text, /@github\/copilot/);
  assert.match(text, /@anthropic-ai\/claude-code/);
  assert.match(text, /@openai\/codex/);
  assert.doesNotMatch(text, /^ENTRYPOINT/m, 'inherits the base entrypoint');
});

test('Dockerfile.agents pins versions (no floating latest)', () => {
  const text = readFileSync(join(root, 'Dockerfile.agents'), 'utf8');
  assert.doesNotMatch(text, /@latest/);
  for (const pkg of ['@github/copilot', '@anthropic-ai/claude-code', '@openai/codex']) {
    assert.match(text, new RegExp(`${pkg.replace('/', '\\/')}@\\d+\\.\\d+\\.\\d+`));
  }
});

const dockerUp = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const baseUp = dockerUp && spawnSync('docker', ['image', 'inspect', 'hodgepodge:dev'], { stdio: 'ignore' }).status === 0;

test('live: derived image runs --version for every agent CLI', { skip: !baseUp && 'docker or hodgepodge:dev unavailable', timeout: 600000 }, () => {
  const build = spawnSync('docker', ['build', '-q', '-f', 'Dockerfile.agents', '-t', 'hodgepodge-agents:test', '.'], { cwd: root, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  for (const cli of CLIS) {
    const run = spawnSync('docker', ['run', '--rm', '--entrypoint', cli, 'hodgepodge-agents:test', '--version'], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${cli}: ${run.stderr}`);
    assert.match(run.stdout, /\d+\.\d+\.\d+/, cli);
  }
});
