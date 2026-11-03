import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { initProject } from '../src/init.js';
import { validateConfig } from '../src/config.js';
import { main, helpText } from '../src/cli.js';
import { freshDir, initGitRepo, withCwd } from './support/project.js';


test('writes .bish-bash-bosh/config.yml with a single adapter/model', () => {
  const dir = freshDir('init-');
  const res = initProject({ dir, adapter: 'agent-x', model: 'model-y' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.dir, dir);
  assert.equal(res.config, join(dir, '.bish-bash-bosh', 'config.yml'));
  const cfg = parseYaml(readFileSync(join(dir, '.bish-bash-bosh', 'config.yml'), 'utf8'));
  assert.deepEqual(validateConfig(cfg), { ok: true, errors: [] });
  assert.equal(cfg.adapter, 'agent-x');
  assert.equal(cfg.model, 'model-y');
  assert.ok(!('allowedPaths' in cfg), 'allowedPaths is gone: the agent may write any path');
  assert.ok(!('requireTestPlan' in cfg), 'requireTestPlan is gone: the test plan is always part of the build loop');
  assert.ok(!('roles' in cfg), 'roles is gone: there is a single adapter/model, not one per role');
  assert.ok(!('targetRepo' in cfg), 'targetRepo is gone: there is no separate target dir');
  assert.ok(!('bish-bash-bosh' in cfg), 'bish-bash-bosh (runtime-copy path) is gone: there is no runtime copy');
  assert.equal(res.committed, false, 'no git repo here, so nothing to commit');
});

test('commits the config when run inside a git repo (so the tree is clean for bish/bosh)', () => {
  const dir = freshDir('init-');
  initGitRepo(dir);
  const res = initProject({ dir, adapter: 'agent-x', model: 'model-y' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.committed, true);
  assert.equal(execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
});

test('automatic setup commits only config and preserves unrelated staged changes', async () => {
  const dir = freshDir('init-');
  initGitRepo(dir);
  writeFileSync(join(dir, 'owner-work.txt'), 'unfinished owner work\n');
  execFileSync('git', ['-C', dir, 'add', 'owner-work.txt']);
  const r = await withCwd(dir, () => run(['bish'], ['agent-x', 'model-y']));
  assert.equal(r.code, 0, r.err);
  const committed = execFileSync('git', ['-C', dir, 'diff-tree', '--root', '--no-commit-id', '--name-only', '-r', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(committed, '.bish-bash-bosh/config.yml');
  const staged = execFileSync('git', ['-C', dir, 'diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim();
  assert.equal(staged, 'owner-work.txt');
});

test('refuses to run if .bish-bash-bosh/config.yml already exists (no silent overwrite)', () => {
  const dir = freshDir('init-');
  mkdirSync(join(dir, '.bish-bash-bosh'), { recursive: true });
  writeFileSync(join(dir, '.bish-bash-bosh', 'config.yml'), 'adapter: x\n');
  const res = initProject({ dir, adapter: 'agent-x', model: 'model-y' });
  assert.equal(res.ok, false);
  assert.match(res.reason, /already exists/);
  assert.equal(readFileSync(join(dir, '.bish-bash-bosh', 'config.yml'), 'utf8'), 'adapter: x\n');
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
  for (const f of ['target', 'bish', 'bosh']) assert.ok(!existsSync(join(dir, f)), f);
});

test('help describes automatic setup in bish, not a separate init command', () => {
  assert.match(helpText(), /bish.*adapter.*model/s);
  assert.doesNotMatch(helpText(), /bish-bash-bosh init|^ {2}init /m);
});

async function run(args, lines = [], deps = {}) {
  const outs = [];
  const errs = [];
  const code = await main(args, { ...deps, stdout: (s) => outs.push(s), stderr: (s) => errs.push(s), input: Readable.from(lines.map((l) => `${l}\n`)) });
  return { code, out: outs.join(''), err: errs.join('') };
}

test('first bish asks for a single adapter/model, commits config and seeds interview without an agent', async () => {
  const dir = freshDir('init-');
  initGitRepo(dir);
  const r = await withCwd(dir, () => run(['bish'], ['copilot', 'm1']));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /adapter.*model/s, 'prompts are shown');
  assert.doesNotMatch(r.out, /interview adapter|reverse adapter|build adapter|qa adapter/, 'one prompt, not one per role');
  assert.match(r.out, /Wrote and committed \.bish-bash-bosh\/config\.yml \(adapter: copilot, model: m1\)/);
  const cfg = parseYaml(readFileSync(join(dir, '.bish-bash-bosh', 'config.yml'), 'utf8'));
  assert.equal(cfg.adapter, 'copilot');
  assert.equal(cfg.model, 'm1');
  for (const file of ['interview.md', 'specification.md', 'bish-log.md']) {
    assert.ok(existsSync(join(dir, '.bish-bash-bosh', file)), file);
  }
  assert.match(r.out, /Run `bish` again to start the interview/);
  assert.equal(execFileSync('git', ['-C', dir, 'show', 'HEAD:.bish-bash-bosh/config.yml'], { encoding: 'utf8' }), readFileSync(join(dir, '.bish-bash-bosh', 'config.yml'), 'utf8'));
});

test('first bish without git leaves the config uncommitted, with guidance', async () => {
  const dir = freshDir('init-');
  const r = await withCwd(dir, () => run(['bish'], ['copilot', 'm1']));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Wrote \.bish-bash-bosh\/config\.yml \(adapter: copilot, model: m1\)\./);
  assert.match(r.out, /Commit it before running bish\/bosh/);
  assert.match(r.out, /git add \.bish-bash-bosh\/config\.yml && git commit/);
});

test('first bish picks adapter/model by number from the suggested list', async () => {
  const dir = freshDir('init-');
  const r = await withCwd(dir, () => run(['bish'], ['1', '1']));
  assert.equal(r.code, 0, r.err);
  const cfg = parseYaml(readFileSync(join(dir, '.bish-bash-bosh', 'config.yml'), 'utf8'));
  assert.equal(cfg.adapter, 'copilot');
  assert.equal(cfg.model, 'gpt-5');
});

test('bish rejects an invalid existing config without prompting or overwriting it', async () => {
  const dir = freshDir('init-');
  mkdirSync(join(dir, '.bish-bash-bosh'), { recursive: true });
  writeFileSync(join(dir, '.bish-bash-bosh', 'config.yml'), 'adapter: x\n');
  const r = await withCwd(dir, () => run(['bish'], []));
  assert.equal(r.code, 2);
  assert.match(r.err, /invalid config/);
  assert.doesNotMatch(r.out, /adapter \(1-/);
  assert.equal(readFileSync(join(dir, '.bish-bash-bosh', 'config.yml'), 'utf8'), 'adapter: x\n');
});

test('first bish aborts without writing config or templates if no adapter or model is given', async () => {
  const dir1 = freshDir('init-');
  const r1 = await withCwd(dir1, () => run(['bish'], ['']));
  assert.equal(r1.code, 2);
  assert.match(r1.err, /no adapter given/);
  const dir2 = freshDir('init-');
  const r2 = await withCwd(dir2, () => run(['bish'], ['copilot', '']));
  assert.equal(r2.code, 2);
  assert.match(r2.err, /no model given/);
  for (const dir of [dir1, dir2]) assert.ok(!existsSync(join(dir, '.bish-bash-bosh')));
});

test('bish validates arguments before starting setup', async () => {
  const dir = freshDir('init-');
  const r = await withCwd(dir, () => run(['bish', '--bogus', 'x'], []));
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown argument/);
  assert.ok(!existsSync(join(dir, '.bish-bash-bosh')));
});

test('the separate init command is removed', async () => {
  const r = await run(['init']);
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown command 'init'/);
});

test('bish uses an existing valid config without prompting or rewriting it', async () => {
  const dir = freshDir('init-');
  initProject({ dir, adapter: 'agent-x', model: 'model-y' });
  const path = join(dir, '.bish-bash-bosh', 'config.yml');
  const original = readFileSync(path, 'utf8');
  const r = await withCwd(dir, () => run(['bish']));
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /adapter \(1-/);
  assert.equal(readFileSync(path, 'utf8'), original);
  assert.ok(existsSync(join(dir, '.bish-bash-bosh', 'interview.md')));
});

test('bish --help does not start setup', async () => {
  const dir = freshDir('init-');
  const r = await withCwd(dir, () => run(['bish', '--help']));
  assert.equal(r.code, 0);
  assert.ok(!existsSync(join(dir, '.bish-bash-bosh')));
});

test('bish --reverse also offers setup when config is missing', async () => {
  const dir = freshDir('init-');
  const r = await withCwd(dir, () => run(['bish', '--reverse'], []));
  assert.equal(r.code, 2);
  assert.match(r.err, /no adapter given/);
  assert.ok(!existsSync(join(dir, '.bish-bash-bosh', 'interview.md')));
});

test('setup preserves an existing interview and shares buffered input with its next round', async () => {
  const dir = freshDir('init-');
  const store = join(dir, '.bish-bash-bosh', 'interview.md');
  mkdirSync(join(dir, '.bish-bash-bosh'));
  writeFileSync(store, '# Interview\n\n1. [ ] Q: What shall we build? A: \n');
  const prompts = [];
  const registry = {
    'agent-x': () => ({
      async run(req) {
        prompts.push(req.prompt);
        return { exitStatus: 0, transcript: '', changedFiles: [] };
      },
    }),
  };
  const r = await withCwd(dir, () => run(['bish'], ['agent-x', 'model-y', 'A greeter'], { registry }));
  assert.equal(r.code, 0, r.err);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /A greeter/);
  assert.match(readFileSync(store, 'utf8'), /1\. \[x\] Q: What shall we build\? A: A greeter/);
  assert.ok(existsSync(join(dir, '.bish-bash-bosh', 'specification.md')));
});

test('setup reports filesystem errors instead of claiming success', async () => {
  const dir = freshDir('init-');
  writeFileSync(join(dir, '.bish-bash-bosh'), 'not a directory');
  const r = await withCwd(dir, () => run(['bish'], ['agent-x', 'model-y']));
  assert.equal(r.code, 2);
  assert.match(r.err, /bish:.*EEXIST/);
  assert.doesNotMatch(r.out, /Wrote/);
});

test('bish rejects malformed YAML without prompting or overwriting it', async () => {
  const dir = freshDir('init-');
  mkdirSync(join(dir, '.bish-bash-bosh'));
  const path = join(dir, '.bish-bash-bosh', 'config.yml');
  writeFileSync(path, 'adapter: [\n');
  const r = await withCwd(dir, () => run(['bish']));
  assert.equal(r.code, 2);
  assert.match(r.err, /invalid YAML/);
  assert.doesNotMatch(r.out, /adapter \(1-/);
  assert.equal(readFileSync(path, 'utf8'), 'adapter: [\n');
});
