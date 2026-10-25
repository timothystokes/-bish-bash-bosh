import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, helpText } from '../src/cli.js';
import { loadSettings, saveSettings, defaultSettingsFile } from '../src/settings.js';

/**
 * @param {string[]} args
 * @param {string} settingsFile
 */
async function run(args, settingsFile) {
  /** @type {string[]} */
  const outs = [];
  /** @type {string[]} */
  const errs = [];
  const code = await main(args, { settingsFile, stdout: (s) => outs.push(s), stderr: (s) => errs.push(s) });
  return { code, out: outs.join(''), err: errs.join('') };
}

test('saveSettings/loadSettings round-trip; missing or malformed file loads as null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'settings-'));
  const file = join(dir, 'nested', 'settings.json');
  assert.equal(loadSettings(file), null);
  saveSettings(file, { repo: '/r', config: '/c.json' });
  assert.deepEqual(loadSettings(file), { repo: '/r', config: '/c.json' });
  writeFileSync(file, '{nope');
  assert.equal(loadSettings(file), null);
  writeFileSync(file, JSON.stringify({ repo: 1 }));
  assert.equal(loadSettings(file), null);
});

test('defaultSettingsFile honours HODGE_SETTINGS, else lives under the home dir', () => {
  assert.equal(defaultSettingsFile({ HODGE_SETTINGS: '/x/s.json' }), '/x/s.json');
  assert.match(defaultSettingsFile({}), /\.hodge[\\/]settings\.json$/);
});

test('init persists repo + config; status then needs no --config/--repo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cli-settings-'));
  const settings = join(root, 'settings.json');
  const sandbox = join(root, 'sb');
  const init = await run(['init', '--dir', sandbox, '--adapter', 'copilot', '--model', 'm1'], settings);
  assert.equal(init.code, 0, init.err);
  const res = JSON.parse(init.out);
  assert.deepEqual(loadSettings(settings), { repo: res.repo, config: res.config });
  const status = await run(['status'], settings);
  assert.equal(status.code, 0, status.err);
  assert.equal(JSON.parse(status.out).iterations, 0);
});

test('failed init does not overwrite persisted settings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cli-settings-'));
  const settings = join(root, 'settings.json');
  saveSettings(settings, { repo: '/keep', config: '/keep.json' });
  const nonEmpty = join(root, 'full');
  await run(['init', '--dir', nonEmpty, '--adapter', 'copilot', '--model', 'm1'], settings);
  writeFileSync(join(nonEmpty, 'x'), '1');
  const again = await run(['init', '--dir', nonEmpty, '--adapter', 'copilot', '--model', 'm1'], settings);
  assert.equal(again.code, 1);
  assert.deepEqual(loadSettings(settings), { repo: join(nonEmpty, 'target'), config: join(nonEmpty, 'hodge.json') });
});

test('explicit flags override persisted settings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cli-settings-'));
  const settings = join(root, 'settings.json');
  saveSettings(settings, { repo: '/nowhere', config: '/nowhere.json' });
  const r = await run(['status', '--config', join(root, 'missing.json')], settings);
  assert.equal(r.code, 2);
  assert.match(r.err, /missing\.json/);
});

test('without init or flags, --config is still required', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cli-settings-'));
  const r = await run(['status'], join(root, 'none.json'));
  assert.equal(r.code, 2);
  assert.match(r.err, /--config <file> is required/);
  assert.match(r.err, /hodge init/);
  assert.equal(existsSync(join(root, 'none.json')), false);
});

test('spec-lint, with no --repo, lints the persisted repo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cli-settings-'));
  const settings = join(root, 'settings.json');
  const init = await run(['init', '--dir', join(root, 'sb'), '--adapter', 'copilot', '--model', 'm1'], settings);
  assert.equal(init.code, 0, init.err);
  const r = await run(['spec-lint'], settings);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(JSON.parse(r.out).ok, true);
});

test('help documents the persisted defaults', () => {
  assert.match(helpText(), /persist/i);
});
