import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { initProject, ROLE_NAMES } from '../src/init.js';
import { validateConfig } from '../src/config.js';
import { main, helpText } from '../src/cli.js';
import { freshDir, withCwd } from './support/project.js';

const ROLE = { adapter: 'agent-x', model: 'model-y' };
const ALL_ROLES = Object.fromEntries(ROLE_NAMES.map((name) => [name, ROLE]));

test('writes hodgepodge.yml with all four roles, default budgets and allowedPaths', () => {
  const dir = freshDir('init-');
  const res = initProject({ dir, roles: ALL_ROLES });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.dir, dir);
  assert.equal(res.config, join(dir, 'hodgepodge.yml'));
  const cfg = parseYaml(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8'));
  assert.deepEqual(validateConfig(cfg), { ok: true, errors: [] });
  assert.deepEqual(cfg.roles, ALL_ROLES);
  assert.equal(cfg.requireTestPlan, true);
  assert.ok(!('targetRepo' in cfg), 'targetRepo is gone: there is no separate target dir');
  assert.ok(!('hodgepodge' in cfg), 'hodgepodge (runtime-copy path) is gone: there is no runtime copy');
});

test('default budgets fit a live agent: one conversation round plus several steps', () => {
  const dir = freshDir('init-');
  initProject({ dir, roles: ALL_ROLES });
  const b = parseYaml(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8')).budgets;
  assert.deepEqual(Object.keys(b).sort(), ['maxIterations', 'maxWallClockSeconds']);
  assert.ok(b.maxWallClockSeconds >= 3600);
  assert.ok(b.maxIterations >= 10);
});

test('default allowedPaths let the build agent write bin/ and lib/ as well as src/', () => {
  const dir = freshDir('init-');
  initProject({ dir, roles: ALL_ROLES });
  const cfg = parseYaml(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8'));
  assert.deepEqual(cfg.allowedPaths, ['src/', 'bin/', 'lib/', 'package.json']);
});

test('refuses to run if hodgepodge.yml already exists (no silent overwrite)', () => {
  const dir = freshDir('init-');
  writeFileSync(join(dir, 'hodgepodge.yml'), 'roles: {}\n');
  const res = initProject({ dir, roles: ALL_ROLES });
  assert.equal(res.ok, false);
  assert.match(res.reason, /already exists/);
  assert.equal(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8'), 'roles: {}\n');
});

test('requires an adapter and model for every role: interview, reverse, build, qa', () => {
  const dir = freshDir('init-');
  for (const name of ROLE_NAMES) {
    assert.equal(initProject({ dir, roles: { ...ALL_ROLES, [name]: { adapter: '', model: 'm' } } }).ok, false, name);
    assert.equal(initProject({ dir, roles: { ...ALL_ROLES, [name]: { adapter: 'a', model: '' } } }).ok, false, name);
    assert.equal(initProject({ dir, roles: { ...ALL_ROLES, [name]: undefined } }).ok, false, name);
  }
});

test('no scaffolding: no target repo, no runtime copy, no launcher scripts', () => {
  const dir = freshDir('init-');
  initProject({ dir, roles: ALL_ROLES });
  for (const f of ['target', '.hodgepodge', 'hodge', 'podge', 'hodgepodge']) assert.ok(!existsSync(join(dir, f)), f);
});

test('help lists init with no --dir (every command operates on cwd)', () => {
  assert.match(helpText(), /hodgepodge init/);
  assert.doesNotMatch(helpText(), /init --dir/);
});

async function run(args, lines = []) {
  const outs = [];
  const errs = [];
  const code = await main(args, { stdout: (s) => outs.push(s), stderr: (s) => errs.push(s), input: Readable.from(lines.map((l) => `${l}\n`)) });
  return { code, out: outs.join(''), err: errs.join('') };
}

test('cli init asks for a single adapter/model and applies it to all four roles', async () => {
  const dir = freshDir('init-');
  const r = await withCwd(dir, () => run(['init'], ['copilot', 'm1']));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /adapter.*model/s, 'prompts are shown');
  assert.doesNotMatch(r.out, /interview adapter|reverse adapter|build adapter|qa adapter/, 'one prompt, not one per role');
  const j = JSON.parse(r.out.match(/\{.*\}/s)[0]);
  assert.equal(j.ok, true);
  assert.equal(j.dir, realpathSync(dir));
  assert.equal(j.config, join(realpathSync(dir), 'hodgepodge.yml'));
  const cfg = parseYaml(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8'));
  for (const name of ROLE_NAMES) assert.deepEqual(cfg.roles[name], { adapter: 'copilot', model: 'm1' }, name);
});

test('cli init picks adapter/model by number from the suggested list', async () => {
  const dir = freshDir('init-');
  const r = await withCwd(dir, () => run(['init'], ['1', '1']));
  assert.equal(r.code, 0, r.err);
  const cfg = parseYaml(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8'));
  for (const name of ROLE_NAMES) assert.deepEqual(cfg.roles[name], { adapter: 'copilot', model: 'gpt-5' }, name);
});

test('cli init refuses when hodgepodge.yml already exists (exit 1, no prompts)', async () => {
  const dir = freshDir('init-');
  writeFileSync(join(dir, 'hodgepodge.yml'), 'roles: {}\n');
  const r = await withCwd(dir, () => run(['init'], []));
  assert.equal(r.code, 1);
  assert.match(r.err, /hodgepodge\.yml already exists/);
});

test('cli init aborts (exit 2) if no adapter or model is given', async () => {
  const dir1 = freshDir('init-');
  const r1 = await withCwd(dir1, () => run(['init'], ['']));
  assert.equal(r1.code, 2);
  assert.match(r1.err, /no adapter given/);
  const dir2 = freshDir('init-');
  const r2 = await withCwd(dir2, () => run(['init'], ['copilot', '']));
  assert.equal(r2.code, 2);
  assert.match(r2.err, /no model given/);
});

test('cli init takes no flags; any argument is rejected', async () => {
  const dir = freshDir('init-');
  const r = await withCwd(dir, () => run(['init', '--bogus', 'x'], []));
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown argument/);
});
