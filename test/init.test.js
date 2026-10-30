import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { initProject } from '../src/init.js';
import { validateConfig } from '../src/config.js';
import { main, helpText } from '../src/cli.js';
import { freshDir, withCwd } from './support/project.js';


test('writes .hodgepodge/config.yml with a single adapter/model', () => {
  const dir = freshDir('init-');
  const res = initProject({ dir, adapter: 'agent-x', model: 'model-y' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.dir, dir);
  assert.equal(res.config, join(dir, '.hodgepodge', 'config.yml'));
  const cfg = parseYaml(readFileSync(join(dir, '.hodgepodge', 'config.yml'), 'utf8'));
  assert.deepEqual(validateConfig(cfg), { ok: true, errors: [] });
  assert.equal(cfg.adapter, 'agent-x');
  assert.equal(cfg.model, 'model-y');
  assert.ok(!('allowedPaths' in cfg), 'allowedPaths is gone: the agent may write any path');
  assert.ok(!('requireTestPlan' in cfg), 'requireTestPlan is gone: the test plan is always part of the build loop');
  assert.ok(!('roles' in cfg), 'roles is gone: there is a single adapter/model, not one per role');
  assert.ok(!('targetRepo' in cfg), 'targetRepo is gone: there is no separate target dir');
  assert.ok(!('hodgepodge' in cfg), 'hodgepodge (runtime-copy path) is gone: there is no runtime copy');
});

test('refuses to run if .hodgepodge/config.yml already exists (no silent overwrite)', () => {
  const dir = freshDir('init-');
  mkdirSync(join(dir, '.hodgepodge'), { recursive: true });
  writeFileSync(join(dir, '.hodgepodge', 'config.yml'), 'adapter: x\n');
  const res = initProject({ dir, adapter: 'agent-x', model: 'model-y' });
  assert.equal(res.ok, false);
  assert.match(res.reason, /already exists/);
  assert.equal(readFileSync(join(dir, '.hodgepodge', 'config.yml'), 'utf8'), 'adapter: x\n');
});

test('requires an adapter and model', () => {
  const dir = freshDir('init-');
  assert.equal(initProject({ dir, adapter: '', model: 'm' }).ok, false);
  assert.equal(initProject({ dir, adapter: 'a', model: '' }).ok, false);
  assert.equal(initProject({ dir, adapter: undefined, model: 'm' }).ok, false);
  assert.equal(initProject({ dir, adapter: 'a', model: undefined }).ok, false);
});

test('no scaffolding: no target repo, no runtime copy, no launcher scripts', () => {
  const dir = freshDir('init-');
  initProject({ dir, adapter: 'agent-x', model: 'model-y' });
  for (const f of ['target', 'hodge', 'podge']) assert.ok(!existsSync(join(dir, f)), f);
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

test('cli init asks for a single adapter/model', async () => {
  const dir = freshDir('init-');
  const r = await withCwd(dir, () => run(['init'], ['copilot', 'm1']));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /adapter.*model/s, 'prompts are shown');
  assert.doesNotMatch(r.out, /interview adapter|reverse adapter|build adapter|qa adapter/, 'one prompt, not one per role');
  const j = JSON.parse(r.out.match(/\{.*\}/s)[0]);
  assert.equal(j.ok, true);
  assert.equal(j.dir, realpathSync(dir));
  assert.equal(j.config, join(realpathSync(dir), '.hodgepodge', 'config.yml'));
  const cfg = parseYaml(readFileSync(join(dir, '.hodgepodge', 'config.yml'), 'utf8'));
  assert.equal(cfg.adapter, 'copilot');
  assert.equal(cfg.model, 'm1');
});

test('cli init picks adapter/model by number from the suggested list', async () => {
  const dir = freshDir('init-');
  const r = await withCwd(dir, () => run(['init'], ['1', '1']));
  assert.equal(r.code, 0, r.err);
  const cfg = parseYaml(readFileSync(join(dir, '.hodgepodge', 'config.yml'), 'utf8'));
  assert.equal(cfg.adapter, 'copilot');
  assert.equal(cfg.model, 'gpt-5');
});

test('cli init refuses when .hodgepodge/config.yml already exists (exit 1, no prompts)', async () => {
  const dir = freshDir('init-');
  mkdirSync(join(dir, '.hodgepodge'), { recursive: true });
  writeFileSync(join(dir, '.hodgepodge', 'config.yml'), 'adapter: x\n');
  const r = await withCwd(dir, () => run(['init'], []));
  assert.equal(r.code, 1);
  assert.match(r.err, /config\.yml already exists/);
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
