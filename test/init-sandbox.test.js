import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSandbox } from '../src/init-sandbox.js';
import { validateConfig } from '../src/config.js';
import { lintSpecs } from '../src/spec-lint.js';
import { main, helpText } from '../src/cli.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fresh = () => join(mkdtempSync(join(tmpdir(), 'init-')), 'sandbox');
const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();
const base = { adapter: 'agent-x', model: 'model-y' };

test('toy seed: repo with spec, red tests and open plan, committed clean', () => {
  const dir = fresh();
  const res = initSandbox({ dir, ...base });
  assert.equal(res.ok, true);
  const repo = join(dir, 'target');
  for (const f of ['specs/add.md', 'tests/PLAN.md', 'tests/add.test.js', 'plan.md', 'package.json', '.gitignore']) {
    assert.ok(existsSync(join(repo, f)), f);
  }
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), '1');
  assert.deepEqual(lintSpecs(repo), { ok: true, problems: [] });
  assert.match(readFileSync(join(repo, 'plan.md'), 'utf8'), /- \[ \]/);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const t = spawnSync('node', ['--test', 'tests/add.test.js'], { cwd: repo, env });
  assert.notEqual(t.status, 0, 'tests must be red before the first loop');
});

test('writes a valid config next to (not inside) the target repo', () => {
  const dir = fresh();
  const res = initSandbox({ dir, ...base });
  assert.equal(res.ok, true);
  const cfg = JSON.parse(readFileSync(join(dir, 'hodge.json'), 'utf8'));
  assert.deepEqual(validateConfig(cfg), { ok: true, errors: [] });
  assert.deepEqual(cfg.roles.build, { adapter: 'agent-x', model: 'model-y' });
  assert.equal(cfg.targetRepo, join(dir, 'target'));
  assert.equal(cfg.requireTestPlan, true);
  assert.ok(!existsSync(join(dir, 'target', 'hodge.json')));
});

test('empty seed: git repo without specs or plan items', () => {
  const dir = fresh();
  assert.equal(initSandbox({ dir, ...base, seed: 'empty' }).ok, true);
  const repo = join(dir, 'target');
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.ok(!existsSync(join(repo, 'specs')));
});

test('refuses a directory inside hodgepodge', () => {
  const res = initSandbox({ dir: join(root, 'sandbox-should-not-exist'), ...base });
  assert.equal(res.ok, false);
  assert.match(String(res.reason), /hodgepodge/);
  assert.ok(!existsSync(join(root, 'sandbox-should-not-exist')));
});

test('refuses an existing non-empty directory and leaves it untouched', () => {
  const dir = fresh();
  mkdirSync(dir);
  writeFileSync(join(dir, 'keep.txt'), 'x');
  const res = initSandbox({ dir, ...base });
  assert.equal(res.ok, false);
  assert.match(String(res.reason), /exists|empty/);
  assert.ok(!existsSync(join(dir, 'target')));
});

test('rejects an unknown seed and an empty adapter or model', () => {
  assert.equal(initSandbox({ dir: fresh(), ...base, seed: 'nope' }).ok, false);
  assert.equal(initSandbox({ dir: fresh(), adapter: '', model: 'm' }).ok, false);
  assert.equal(initSandbox({ dir: fresh(), adapter: 'a', model: '' }).ok, false);
});

test('help lists init', () => {
  assert.match(helpText(), /hodge init --dir/);
});

/** @param {string[]} args */
async function run(args) {
  /** @type {string[]} */
  const outs = [];
  /** @type {string[]} */
  const errs = [];
  const code = await main(args, { settingsFile: join(mkdtempSync(join(tmpdir(), 'init-settings-')), 's.json'), stdout: (s) => outs.push(s), stderr: (s) => errs.push(s) });
  return { code, out: outs.join(''), err: errs.join('') };
}

test('cli init prints JSON and creates the sandbox', async () => {
  const dir = fresh();
  const r = await run(['init', '--dir', dir, '--adapter', 'a', '--model', 'm']);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.ok, true);
  assert.equal(j.repo, join(dir, 'target'));
  assert.equal(j.config, join(dir, 'hodge.json'));
  assert.ok(existsSync(j.config));
});

test('cli init requires --dir, --adapter and --model; exits 1 on refusal', async () => {
  assert.equal((await run(['init', '--adapter', 'a', '--model', 'm'])).code, 2);
  assert.equal((await run(['init', '--dir', fresh(), '--model', 'm'])).code, 2);
  assert.equal((await run(['init', '--dir', fresh(), '--adapter', 'a'])).code, 2);
  assert.equal((await run(['init', '--dir', fresh(), '--adapter', 'a', '--model', 'm', '--bogus', 'x'])).code, 2);
  const r = await run(['init', '--dir', join(root, 'nope'), '--adapter', 'a', '--model', 'm']);
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.out).ok, false);
});
