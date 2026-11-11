import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { helpText, LOGO, main } from '../../src/cli/cli.js';
import { CONFIG_FILE } from '../../src/shared/project-config.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(new URL(path, new URL('../../', import.meta.url)), 'utf8');

test('package exposes the renamed harness and three phase commands', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.name, 'bish-bash-bosh');
  assert.deepEqual(pkg.bin, {
    '-bish': 'bin/-bish',
    '-bash': 'bin/-bash',
    '-bosh': 'bin/-bosh',
  });
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.deepEqual(lock.packages[''].bin, pkg.bin);
  for (const bin of Object.values(pkg.bin)) {
    accessSync(new URL(bin, new URL('../../', import.meta.url)), constants.X_OK);
    const result = spawnSync(fileURLToPath(new URL(bin, new URL('../../', import.meta.url))), ['--help'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), helpText().trim());
  }
});

test('config, help and logo use the new project identity', () => {
  assert.equal(CONFIG_FILE, '.bish-bash-bosh/config.yml');
  assert.match(helpText(), /-bish-bash-bosh: harness for loop engineering/);
  assert.doesNotMatch(helpText(), /BISH_BASH_BOSH_DEBUG/);
  assert.ok(LOGO.length > 0);
});

test('local-only harness has no container implementation or command', async () => {
  for (const path of ['Dockerfile', 'Dockerfile.agents', '.dockerignore', 'infra/stack.js', 'src/state-machine.js', 'src/kill-switch.js']) {
    assert.equal(existsSync(new URL(path, new URL('../../', import.meta.url))), false, path);
  }
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.devDependencies?.constructs, undefined);
  assert.doesNotMatch(helpText(), /--container|kill/);
  const errors = [];
  assert.equal(await main(['kill'], { stdout: () => {}, stderr: (s) => errors.push(s) }), 2);
  assert.match(errors.join(''), /unknown command 'kill'/);
});
