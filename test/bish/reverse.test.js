import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReverse, buildReversePrompt } from '../../src/bish/bish-reverse.js';
import { loadModePrompt } from '../../src/shared/prompts.js';
import { main } from '../../src/cli/cli.js';
import { writeProjectConfig, commitProjectConfig, withCwd, initGitRepo } from '../support/project.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

function makeRepo() {
  const dir = initGitRepo(mkdtempSync(join(tmpdir(), 'bish-rev-')));
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

const SPEC = '.bish-bash-bosh/specification.md';
const goodWrites = {
  [SPEC]: '# Specification\n\n1. [ ] C: greet returns "hello <name>". B: Friendly output.\n',
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
        const { createFakeAdapter } = await import('../../src/adapters/adapter.js');
        return createFakeAdapter({ exitStatus, transcript: 't', writes }).run(req);
      },
    },
  };
};

test('reverse prompt covers the unchanged source and carries the specification template', () => {
  assert.match(loadModePrompt('reverse'), /do not change/i);
  const dir = makeRepo();
  const p = buildReversePrompt(dir, 'focus on greet');
  assert.match(p, /focus on greet/);
  assert.match(p, /# Specification/);
  assert.match(p, /C: <constraint> B: <benefit>/);
  assert.match(buildReversePrompt(dir), /Whole codebase/i);
});

test('a well-formed specification is committed with a record', async () => {
  const dir = makeRepo();
  const res = await runReverse({ config: config(), repoDir: dir, runId: 'r1', adapter: agent(goodWrites).adapter, identity });
  assert.equal(res.status, 'ok');
  assert.equal(res.sha, git(dir, 'rev-parse', 'HEAD'));
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(JSON.parse(readFileSync(join(dir, '.bish-bash-bosh', 'runs', 'r1', 'reverse', 'record.json'), 'utf8')).status, 'ok');
  assert.ok(existsSync(join(dir, SPEC)));
});

test('a specification with no well-formed items discards the work', async () => {
  const dir = makeRepo();
  const res = await runReverse({ config: config(), repoDir: dir, runId: 'r1', identity, adapter: agent({ [SPEC]: 'no items\n' }).adapter });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /no `<n>\. \[ \] C:/);
  assert.equal(existsSync(join(dir, SPEC)), false);
});

test('source changes are refused and reverted', async () => {
  const dir = makeRepo();
  const res = await runReverse({
    config: config(), repoDir: dir, runId: 'r1', identity,
    adapter: agent({ ...goodWrites, 'src/greet.js': 'export const greet = () => 1;\n' }).adapter,
  });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /src\/greet\.js/);
  assert.match(readFileSync(join(dir, 'src', 'greet.js'), 'utf8'), /hello/);
});

test('agent failure is failed and discarded', async () => {
  const dir = makeRepo();
  const res = await runReverse({ config: config(), repoDir: dir, runId: 'r1', adapter: agent(goodWrites, 1).adapter, identity });
  assert.equal(res.status, 'failed');
  assert.equal(existsSync(join(dir, SPEC)), false);
});

test('gates: dirty tree and harness repo make no agent call', async () => {
  const dir = makeRepo();
  const a = agent(goodWrites);
  const base = { config: config(), repoDir: dir, runId: 'r1', adapter: a.adapter, identity };
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
      registry, identity, stdout: (s) => { out.push(s); }, stderr: () => {},
    }));
  assert.equal(code, 0);
  assert.match(out.join(''), /^Reverse-engineered the specification/);

  const dir2 = makeRepo();
  commitProjectConfig(dir2, config({ adapter: 'rv' }));
  const bad = await withCwd(dir2, () =>
    main(['bish', '--reverse'], {
      registry: { rv: () => agent({ [SPEC]: "no items\n" }).adapter }, identity, stdout: () => {}, stderr: () => {},
    }));
  assert.equal(bad, 1);

  const err = /** @type {string[]} */ ([]);
  const noRoleDir = initGitRepo(mkdtempSync(join(tmpdir(), 'bish-rev-norole-')));
  writeProjectConfig(noRoleDir, config({ adapter: 'missing' }));
  assert.equal(await withCwd(noRoleDir, () => main(['bish', '--reverse'], { registry, stdout: () => {}, stderr: (s) => { err.push(s); } })), 2);
  assert.match(err.join(''), /unknown adapter 'missing'/);
});
