import { Readable } from 'node:stream';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateConfig } from '../src/config.js';
import { runInterview, buildInterviewPrompt } from '../src/hodge-interview.js';
import { runLoop } from '../src/podge-driver.js';
import { checkReadiness } from '../src/readiness.js';
import { main } from '../src/cli.js';
import { freshDir, seedObjectiveProject, withCwd, writeProjectConfig } from './support/project.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();
const buildConfig = {
  roles: { build: { adapter: 'agent-x', model: 'model-y' }, interview: { adapter: 'agent-x', model: 'model-y' }, reverse: { adapter: 'agent-x', model: 'model-y' } },
  allowedPaths: ['src/', 'bin/', 'lib/', 'package.json'],
  requireTestPlan: true,
};
const identity = { root: '/nonexistent/hodgepodge', remotes: [] };

// Seeds a project fixture (plan.md + package.json + .hodgepodge/config.yml), committed clean. No kit is
// scaffolded any more: the interview store self-bootstraps on the first `hodge` round.
function sandbox() {
  const dir = freshDir('objseed-');
  seedObjectiveProject(dir);
  writeProjectConfig(dir, buildConfig);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'seed');
  return { dir, repo: dir, config: buildConfig };
}

test('objective seed has no kit to copy: nothing under .hodgepodge until hodge bootstraps it', () => {
  const { repo } = sandbox();
  assert.ok(!existsSync(join(repo, '.hodgepodge', 'interview.md')), 'no question until hodge bootstraps the objective');
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.ok(!existsSync(join(repo, 'specs')), 'specs come from the conversation, not the seed');
});

test('config has an interview role and requires the test plan', () => {
  const { config } = sandbox();
  assert.deepEqual(validateConfig(config), { ok: true, errors: [] });
  assert.deepEqual(config.roles.interview, { adapter: 'agent-x', model: 'model-y' });
  assert.equal(config.requireTestPlan, true);
});

test('hodge has no --objective option (the objective is gathered interactively)', async () => {
  /** @type {string[]} */
  const errs = [];
  const code = await main(['hodge', '--objective', 'x'], { stdout: () => {}, stderr: (s) => errs.push(s) });
  assert.equal(code, 2);
  assert.match(errs.join(''), /unknown argument '--objective'/);
});

test('the interview prompt carries stage and current readiness gaps once the store exists', () => {
  const { repo } = sandbox();
  mkdirSync(join(repo, '.hodgepodge'), { recursive: true });
  writeFileSync(join(repo, '.hodgepodge', 'interview.md'), '# Interview\n\n1 - Answered: [x]; Specified: [x]; Topic: objective; Q: Describe the objective; A: Build a greeter CLI\n');
  const p = buildInterviewPrompt(repo, 'Build a greeter CLI');
  assert.doesNotMatch(p, /## Readiness gaps/, 'no readiness check until the interview is ending');
  assert.match(p, /## Stage: broad/);
  assert.match(p, /never open `?\.hodgepodge\/interview\.md`?/i);
  const closing = buildInterviewPrompt(repo, 'Build a greeter CLI', true);
  assert.match(closing, /## Readiness gaps/);
  assert.match(closing, /specs\/ has no \*\.md specs/);
});

const goodSpec = `# Spec: Greeter
Implementation: none

## Requirements
- R-greet-1: \`greet(name)\` must return "Hello, name!".
- R-greet-2: \`greet\` must throw a TypeError when name is not a string.
- R-greet-3: \`greet\` must trim surrounding whitespace from name.

## Examples
- \`greet('Ann')\` -> \`Hello, Ann!\`
- \`greet(1)\` -> throws TypeError

## Dimensions
- Actors and goals: covered
- Behaviour: covered
- Inputs and outputs: covered
- Failure paths: covered
- Edge cases: n/a: single-purpose pure function
- Interfaces and data: n/a: one in-process function
- Non-functional: n/a: no runtime limits for a pure function
- Constraints: n/a: no platform constraints
- Acceptance: covered
- Out of scope: covered

## Out of scope
- Localisation.
`;

/** @param {Record<string, string>} writes */
const agent = (writes) => ({
  async run(req) {
    for (const [f, text] of Object.entries(writes)) {
      mkdirSync(join(req.cwd, f, '..'), { recursive: true });
      writeFileSync(join(req.cwd, f), text);
    }
    return { transcript: 't', exitStatus: 0, changedFiles: Object.keys(writes) };
  },
});

// A project with the interview store already bootstrapped (question 1 answered); `objective` is passed to
// `runInterview` explicitly, as `runObjective` would once it has bootstrapped the store.
function briefed() {
  const { dir, repo, config } = sandbox();
  mkdirSync(join(repo, '.hodgepodge'), { recursive: true });
  writeFileSync(join(repo, '.hodgepodge', 'interview.md'), '# Interview\n\n1 - Answered: [x]; Specified: [x]; Topic: objective; Q: Describe the objective; A: Build a greeter\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'objective');
  return { dir, repo, config };
}

test('interview with a bootstrapped store: lint-clean but not ready is kept as incomplete (a round), not discarded', async () => {
  const { repo, config } = briefed();
  const coarse = goodSpec.replace(/- R-greet-3: .*\n/, '');
  const res = await runInterview({
    config, repoDir: repo, runId: 'r1', identity, objective: 'Build a greeter', closing: true,
    adapter: agent({ 'specs/greet.md': coarse }),
  });
  assert.equal(res.status, 'incomplete');
  assert.match(res.reason ?? '', /2 requirements/);
  assert.ok(existsSync(join(repo, 'specs', 'greet.md')), 'progress is kept for the next round');
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.equal(JSON.parse(readFileSync(join(repo, '.hodgepodge', 'runs', 'r1', 'interview', 'record.json'), 'utf8')).status, 'incomplete');
});

test('interview with a bootstrapped store: a round that leaves a question runs no spec-lint, even with a broken spec', async () => {
  const { repo, config } = briefed();
  const res = await runInterview({
    config, repoDir: repo, runId: 'r1', identity, objective: 'Build a greeter',
    adapter: agent({ 'specs/bad.md': 'no title\n', '.hodgepodge/response.json': '{"resolved":[],"gaps":[{"topic":"T","question":"Who?","default":"devs"}]}' }),
  });
  assert.equal(res.status, 'incomplete');
  assert.match(res.reason ?? '', /waiting for the owner/);
});

test('interview with a bootstrapped store: a ready result is ok; it may write .hodgepodge/notes.md', async () => {
  const { repo, config } = briefed();
  const res = await runInterview({
    config, repoDir: repo, runId: 'r1', identity, objective: 'Build a greeter',
    adapter: agent({
      'specs/greet.md': goodSpec,
      '.hodgepodge/notes.md': '- locale is out of scope\n',
    }),
  });
  assert.equal(res.status, 'ok', JSON.stringify(res));
  assert.deepEqual(checkReadiness(repo), { ready: true, gaps: [] });
});

test('run is gated until the objective is ready (no agent call)', async () => {
  const { repo, config } = briefed();
  let called = 0;
  const adapter = { async run() { called++; return { transcript: '', exitStatus: 0, changedFiles: [] }; } };
  const res = await runLoop({ config, repoDir: repo, runId: 'r1', adapter, identity, requireTestPlan: true });
  assert.equal(res.status, 'gated');
  assert.match(String(res.reason), /not ready/);
  assert.equal(called, 0);
});

test('hodgepodge ready reports gaps then ready', async () => {
  const { repo } = briefed();
  /** @type {string[]} */
  const outs = [];
  const run = async (/** @type {string[]} */ args) => {
    outs.length = 0;
    const code = await withCwd(repo, () => main(args, { stdout: (s) => outs.push(s), stderr: () => {} }));
    return { code, out: outs.join('') };
  };
  const notReady = await run(['ready']);
  assert.equal(notReady.code, 1);
  assert.equal(JSON.parse(notReady.out).ready, false);
  mkdirSync(join(repo, 'specs'));
  writeFileSync(join(repo, 'specs', 'greet.md'), goodSpec);
  const ok = await run(['ready']);
  assert.equal(ok.code, 0, ok.out);
  assert.deepEqual(JSON.parse(ok.out), { ready: true, gaps: [] });
});

test('hodge on a fresh project asks for the objective and is gated without one', async () => {
  const { repo } = sandbox();
  let out = '';
  const code = await withCwd(repo, () =>
    main(['hodge'], {
      registry: { 'agent-x': () => ({ run: async () => { throw new Error('agent must not run without an objective'); } }) },
      input: Readable.from(['']),
      stdout: (s) => (out += s),
      stderr: () => {},
    }),
  );
  assert.equal(code, 1);
  assert.match(out, /Describe the objective/);
  assert.match(out, /no objective description given/);
});

test('objective seed package.json has a test script so the tests gate can run', () => {
  const { repo } = sandbox();
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js');
});
