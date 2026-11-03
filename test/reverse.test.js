import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReverse, buildReversePrompt } from '../src/bish-reverse.js';
import { loadModePrompt } from '../src/prompts.js';
import { main } from '../src/cli.js';
import { lintSpecs } from '../src/spec-lint.js';
import { writeProjectConfig, commitProjectConfig, withCwd } from './support/project.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'bish-rev-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'greet.js'), 'export const greet = (n) => `hello ${n}`;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const config = (/** @type {{adapter?: string, model?: string}} */ overrides = {}) => ({
  adapter: 'f',
  model: 'm',
  ...overrides,
});

const identity = { root: '/nonexistent/bish-bash-bosh', remotes: [] };

const goodWrites = {
  'specs/greet.md': '# Spec: Greeter\nImplementation: none\n\n## Requirements\n- R-greet-1: greet returns "hello <name>"\n',
  'tests/PLAN.md': '| Spec | Tests |\n|---|---|\n| specs/greet.md | tests/greet.test.js |\n| R-greet-1 | tests/greet.test.js |\n',
  'tests/greet.test.js': 'ok\n',
};

/** @param {Record<string, string>} writes @param {number} [exitStatus] */
const agent = (writes, exitStatus = 0) => {
  /** @type {string[]} */
  const prompts = [];
  return {
    prompts,
    adapter: {
      async run(req) {
        prompts.push(req.prompt);
        const { createFakeAdapter } = await import('../src/adapter.js');
        return createFakeAdapter({ exitStatus, transcript: 't', writes }).run(req);
      },
    },
  };
};

const pass = ['node', '-e', 'process.exit(0)'];
const fail = ['node', '-e', 'process.exit(1)'];

test('reverse prompt exists and covers characterization of unchanged source', () => {
  assert.match(loadModePrompt('reverse'), /characterization/i);
  assert.match(loadModePrompt('reverse'), /do not (change|modify)/i);
  const dir = makeRepo();
  const p = buildReversePrompt(dir, 'focus on greet');
  assert.match(p, /focus on greet/);
  assert.match(p, /# Spec: <name/);
  assert.match(p, /\| Spec \| Tests \|/);
  assert.match(buildReversePrompt(dir), /Whole codebase/i);
});

test('lint-clean spec with green characterization suite is committed with a record', async () => {
  const dir = makeRepo();
  const a = agent(goodWrites);
  const res = await runReverse({ config: config(), repoDir: dir, runId: 'r1', adapter: a.adapter, testCommand: pass, identity });
  assert.equal(res.status, 'ok');
  assert.equal(res.sha, git(dir, 'rev-parse', 'HEAD'));
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(lintSpecs(dir).ok, true);
  assert.equal(JSON.parse(readFileSync(join(dir, '.bish-bash-bosh', 'runs', 'r1', 'reverse', 'record.json'), 'utf8')).status, 'ok');
  assert.ok(existsSync(join(dir, 'specs', 'greet.md')));
});

test('a red characterization suite discards the work', async () => {
  const dir = makeRepo();
  const res = await runReverse({ config: config(), repoDir: dir, runId: 'r1', adapter: agent(goodWrites).adapter, testCommand: fail, identity });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /characterization/);
  assert.equal(existsSync(join(dir, 'specs')), false);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('spec-lint failure discards the work', async () => {
  const dir = makeRepo();
  const res = await runReverse({
    config: config(), repoDir: dir, runId: 'r1', testCommand: pass, identity,
    adapter: agent({ 'specs/bad.md': 'no title\n', 'tests/PLAN.md': '| Spec | Tests |\n' }).adapter,
  });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /spec-lint failed/);
  assert.equal(existsSync(join(dir, 'specs')), false);
});

test('source changes are refused and reverted', async () => {
  const dir = makeRepo();
  const res = await runReverse({
    config: config(), repoDir: dir, runId: 'r1', testCommand: pass, identity,
    adapter: agent({ ...goodWrites, 'src/greet.js': 'export const greet = () => 1;\n' }).adapter,
  });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /src\/greet\.js/);
  assert.match(readFileSync(join(dir, 'src', 'greet.js'), 'utf8'), /hello/);
});

test('agent failure is failed and discarded', async () => {
  const dir = makeRepo();
  const res = await runReverse({ config: config(), repoDir: dir, runId: 'r1', adapter: agent(goodWrites, 1).adapter, testCommand: pass, identity });
  assert.equal(res.status, 'failed');
  assert.equal(existsSync(join(dir, 'specs')), false);
});

test('gates: dirty tree and harness repo make no agent call', async () => {
  const dir = makeRepo();
  const a = agent(goodWrites);
  const base = { config: config(), repoDir: dir, runId: 'r1', adapter: a.adapter, testCommand: pass, identity };
  const self = await runReverse({ ...base, identity: { root: dir, remotes: [] } });
  assert.equal(self.status, 'gated');
  writeFileSync(join(dir, 'dirty.txt'), 'x');
  assert.match((await runReverse(base)).reason ?? '', /not clean/);
  assert.equal(a.prompts.length, 0);
});

test('bish --reverse uses the configured adapter; usage errors exit 2', async () => {
  const dir = makeRepo();
  commitProjectConfig(dir, config({ adapter: 'rv' }));
  const out = /** @type {string[]} */ ([]);
  const registry = { rv: () => agent(goodWrites).adapter };
  const code = await withCwd(dir, () =>
    main(['bish', '--reverse'], {
      registry, identity, testCommand: pass, stdout: (s) => { out.push(s); }, stderr: () => {},
    }));
  assert.equal(code, 0);
  assert.match(out.join(''), /^Reverse-engineered specs and tests/);

  const dir2 = makeRepo();
  commitProjectConfig(dir2, config({ adapter: 'rv' }));
  const bad = await withCwd(dir2, () =>
    main(['bish', '--reverse'], {
      registry, identity, testCommand: fail, stdout: () => {}, stderr: () => {},
    }));
  assert.equal(bad, 1);

  const err = /** @type {string[]} */ ([]);
  const noRoleDir = mkdtempSync(join(tmpdir(), 'bish-rev-norole-'));
  writeProjectConfig(noRoleDir, config({ adapter: 'missing' }));
  assert.equal(await withCwd(noRoleDir, () => main(['bish', '--reverse'], { registry, stdout: () => {}, stderr: (s) => { err.push(s); } })), 2);
  assert.match(err.join(''), /unknown adapter 'missing'/);
});
