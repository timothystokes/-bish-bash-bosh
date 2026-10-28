import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { initProject } from '../src/init.js';
import { validateConfig } from '../src/config.js';
import { main, helpText } from '../src/cli.js';
import { freshDir, withCwd } from './support/project.js';

test('writes hodgepodge.yml with the build role, default budgets and allowedPaths', () => {
  const dir = freshDir('init-');
  const res = initProject({ dir, build: { adapter: 'agent-x', model: 'model-y' } });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.dir, dir);
  assert.equal(res.config, join(dir, 'hodgepodge.yml'));
  const cfg = parseYaml(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8'));
  assert.deepEqual(validateConfig(cfg), { ok: true, errors: [] });
  assert.deepEqual(cfg.roles.build, { adapter: 'agent-x', model: 'model-y' });
  assert.equal(cfg.requireTestPlan, true);
  assert.ok(!('targetRepo' in cfg), 'targetRepo is gone: there is no separate target dir');
  assert.ok(!('hodgepodge' in cfg), 'hodgepodge (runtime-copy path) is gone: there is no runtime copy');
});

test('also seeds the interview and reverse roles so hodge works right after init', () => {
  const dir = freshDir('init-');
  initProject({ dir, build: { adapter: 'agent-x', model: 'model-y' } });
  const cfg = parseYaml(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8'));
  assert.deepEqual(cfg.roles.interview, { adapter: 'agent-x', model: 'model-y' });
  assert.deepEqual(cfg.roles.reverse, { adapter: 'agent-x', model: 'model-y' });
});

test('an optional qa role is written alongside build', () => {
  const dir = freshDir('init-');
  initProject({ dir, build: { adapter: 'agent-x', model: 'model-y' }, qa: { adapter: 'agent-q', model: 'model-q' } });
  const cfg = parseYaml(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8'));
  assert.deepEqual(cfg.roles.qa, { adapter: 'agent-q', model: 'model-q' });
});

test('default budgets fit a live agent: one conversation round plus several steps', () => {
  const dir = freshDir('init-');
  initProject({ dir, build: { adapter: 'a', model: 'm' } });
  const b = parseYaml(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8')).budgets;
  assert.deepEqual(Object.keys(b).sort(), ['maxIterations', 'maxWallClockSeconds']);
  assert.ok(b.maxWallClockSeconds >= 3600);
  assert.ok(b.maxIterations >= 10);
});

test('default allowedPaths let the build agent write bin/ and lib/ as well as src/', () => {
  const dir = freshDir('init-');
  initProject({ dir, build: { adapter: 'a', model: 'm' } });
  const cfg = parseYaml(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8'));
  assert.deepEqual(cfg.allowedPaths, ['src/', 'bin/', 'lib/', 'package.json']);
});

test('refuses to run if hodgepodge.yml already exists (no silent overwrite)', () => {
  const dir = freshDir('init-');
  writeFileSync(join(dir, 'hodgepodge.yml'), 'roles: {}\n');
  const res = initProject({ dir, build: { adapter: 'a', model: 'm' } });
  assert.equal(res.ok, false);
  assert.match(res.reason, /already exists/);
  assert.equal(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8'), 'roles: {}\n');
});

test('requires a build adapter and model', () => {
  const dir = freshDir('init-');
  assert.equal(initProject({ dir, build: { adapter: '', model: 'm' } }).ok, false);
  assert.equal(initProject({ dir, build: { adapter: 'a', model: '' } }).ok, false);
  assert.equal(initProject({ dir, build: undefined }).ok, false);
});

test('no scaffolding: no target repo, no runtime copy, no launcher scripts', () => {
  const dir = freshDir('init-');
  initProject({ dir, build: { adapter: 'a', model: 'm' } });
  for (const f of ['target', '.hodgepodge', 'hodge', 'podge', 'hodgepodge']) assert.ok(!existsSync(join(dir, f)), f);
});

test('help lists init with no --dir (every command operates on cwd)', () => {
  assert.match(helpText(), /hodgepodge init/);
  assert.doesNotMatch(helpText(), /init --dir/);
});

/** @param {string[]} args @param {string[]} [lines] feeds stdin, one answer per prompt */
async function run(args, lines = []) {
  /** @type {string[]} */
  const outs = [];
  /** @type {string[]} */
  const errs = [];
  const code = await main(args, { stdout: (s) => outs.push(s), stderr: (s) => errs.push(s), input: Readable.from(lines.map((l) => `${l}\n`)) });
  return { code, out: outs.join(''), err: errs.join('') };
}

test('cli init asks for build adapter/model, then writes hodgepodge.yml and prints JSON', async () => {
  const dir = freshDir('init-');
  const r = await withCwd(dir, () => run(['init'], ['copilot', 'm1', '']));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /build adapter:.*build model:.*qa adapter/s, 'prompts are shown');
  const j = JSON.parse(r.out.match(/\{.*\}/s)[0]);
  assert.equal(j.ok, true);
  assert.equal(j.dir, realpathSync(dir));
  assert.equal(j.config, join(realpathSync(dir), 'hodgepodge.yml'));
  const cfg = parseYaml(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8'));
  assert.deepEqual(cfg.roles.build, { adapter: 'copilot', model: 'm1' });
  assert.ok(!cfg.roles.qa, 'qa is skipped when its adapter prompt is left blank');
});

test('cli init also asks for an optional qa adapter/model', async () => {
  const dir = freshDir('init-');
  const r = await withCwd(dir, () => run(['init'], ['copilot', 'm1', 'copilot', 'm2']));
  assert.equal(r.code, 0, r.err);
  const cfg = parseYaml(readFileSync(join(dir, 'hodgepodge.yml'), 'utf8'));
  assert.deepEqual(cfg.roles.qa, { adapter: 'copilot', model: 'm2' });
});

test('cli init refuses when hodgepodge.yml already exists (exit 1, no prompts)', async () => {
  const dir = freshDir('init-');
  writeFileSync(join(dir, 'hodgepodge.yml'), 'roles: {}\n');
  const r = await withCwd(dir, () => run(['init'], []));
  assert.equal(r.code, 1);
  assert.match(r.err, /hodgepodge\.yml already exists/);
});

test('cli init aborts (exit 2) if no build adapter or model is given', async () => {
  const dir1 = freshDir('init-');
  const r1 = await withCwd(dir1, () => run(['init'], ['']));
  assert.equal(r1.code, 2);
  assert.match(r1.err, /no build adapter given/);
  const dir2 = freshDir('init-');
  const r2 = await withCwd(dir2, () => run(['init'], ['copilot', '']));
  assert.equal(r2.code, 2);
  assert.match(r2.err, /no build model given/);
});

test('cli init takes no flags; any argument is rejected', async () => {
  const dir = freshDir('init-');
  const r = await withCwd(dir, () => run(['init', '--bogus', 'x'], []));
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown argument/);
});
