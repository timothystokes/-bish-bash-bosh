import { Readable } from 'node:stream';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSandbox } from '../src/init-sandbox.js';
import { validateConfig } from '../src/config.js';
import { runInterview, buildInterviewPrompt } from '../src/interview.js';
import { runLoop } from '../src/driver.js';
import { checkReadiness } from '../src/readiness.js';
import { main } from '../src/cli.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fresh = () => join(mkdtempSync(join(tmpdir(), 'objseed-')), 'sb');
const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();
const base = { adapter: 'agent-x', model: 'model-y', seed: 'objective' };
const identity = { root: '/nonexistent/hodgepodge', remotes: [] };

const KIT = ['PHASES.md', 'INTERVIEW.md', 'READINESS.md', 'BRIEF.md', 'OPEN-QUESTIONS.md', 'CONVERSATION.md'];

test('objective seed copies the general kit and a starter plan; nothing is solution-specific', () => {
  const dir = fresh();
  const res = initSandbox({ dir, ...base });
  assert.equal(res.ok, true, JSON.stringify(res));
  const repo = join(dir, 'target');
  for (const f of KIT) assert.ok(existsSync(join(repo, 'objective', f)), f);
  assert.match(readFileSync(join(repo, 'objective', 'BRIEF.md'), 'utf8'), /Not yet written/);
  assert.match(readFileSync(join(repo, 'plan.md'), 'utf8'), /- \[ \]/);
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.ok(!existsSync(join(repo, 'specs')), 'specs come from the conversation, not the seed');
});

test('the kit documents phases, the interview protocol and the readiness thresholds', () => {
  const dir = fresh();
  initSandbox({ dir, ...base });
  const read = (/** @type {string} */ f) => readFileSync(join(dir, 'target', 'objective', f), 'utf8');
  assert.match(read('PHASES.md'), /hodge/);
  assert.match(read('PHASES.md'), /Discover[\s\S]*Specify[\s\S]*Test plan[\s\S]*Plan[\s\S]*Build/);
  assert.match(read('INTERVIEW.md'), /topic batches/i);
  assert.match(read('READINESS.md'), /at least 3 requirements/i);
  assert.match(read('READINESS.md'), /hodgepodge ready/);
});

test('config gets an interview role and requires the test plan', () => {
  const dir = fresh();
  initSandbox({ dir, ...base });
  const cfg = JSON.parse(readFileSync(join(dir, 'hodge.json'), 'utf8'));
  assert.deepEqual(validateConfig(cfg), { ok: true, errors: [] });
  assert.deepEqual(cfg.roles.interview, { adapter: 'agent-x', model: 'model-y' });
  assert.equal(cfg.requireTestPlan, true);
});

test('hodgepodge init has no --objective option (the objective is gathered by `hodge`)', async () => {
  /** @type {string[]} */
  const errs = [];
  const code = await main(['init', '--dir', fresh(), '--adapter', 'a', '--model', 'm', '--seed', 'objective', '--objective', 'x'], { stdout: () => {}, stderr: (s) => errs.push(s) });
  assert.equal(code, 2);
  assert.match(errs.join(''), /unknown argument '--objective'/);
});

test('the kit is part of the interview prompt together with stage and current readiness gaps', () => {
  const dir = fresh();
  initSandbox({ dir, ...base });
  const p = buildInterviewPrompt(join(dir, 'target'), 'Build a greeter CLI');
  assert.match(p, /INTERVIEW\.md/);
  assert.match(p, /READINESS\.md/);
  assert.doesNotMatch(p, /## Readiness gaps/, 'no readiness check until the interview is ending');
  assert.match(p, /## Stage: broad/);
  assert.match(p, /never open objective\/CONVERSATION\.md/i);
  const closing = buildInterviewPrompt(join(dir, 'target'), 'Build a greeter CLI', true);
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
  /** @param {import('../src/adapter.js').AdapterRequest} req */
  async run(req) {
    for (const [f, text] of Object.entries(writes)) {
      mkdirSync(dirname(join(req.cwd, f)), { recursive: true });
      writeFileSync(join(req.cwd, f), text);
    }
    return { transcript: 't', usage: { tokens: 1, cost: 0 }, exitStatus: 0, changedFiles: Object.keys(writes) };
  },
});

const sandbox = (/** @type {string} */ objective) => {
  const dir = fresh();
  assert.equal(initSandbox({ dir, ...base }).ok, true);
  writeFileSync(join(dir, 'target', 'objective', 'BRIEF.md'), `# Objective brief\n\n${objective}\n`);
  git(join(dir, 'target'), '-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qam', 'brief');
  return { dir, repo: join(dir, 'target'), config: JSON.parse(readFileSync(join(dir, 'hodge.json'), 'utf8')) };
};

test('interview with a kit: lint-clean but not ready is kept as incomplete (a round), not discarded', async () => {
  const { repo, config } = sandbox('Build a greeter');
  const coarse = goodSpec.replace(/- R-greet-3: .*\n/, '');
  const res = await runInterview({
    config, repoDir: repo, runId: 'r1', identity, objective: 'Build a greeter', closing: true,
    adapter: agent({ 'specs/greet.md': coarse }),
  });
  assert.equal(res.status, 'incomplete');
  assert.match(res.reason ?? '', /2 requirements/);
  assert.ok(existsSync(join(repo, 'specs', 'greet.md')), 'progress is kept for the next round');
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.equal(JSON.parse(readFileSync(join(repo, 'runs', 'r1', 'interview', 'record.json'), 'utf8')).status, 'incomplete');
});

test('interview with a kit: a round that leaves a question runs no spec-lint, even with a broken spec', async () => {
  const { repo, config } = sandbox('Build a greeter');
  const res = await runInterview({
    config, repoDir: repo, runId: 'r1', identity, objective: 'Build a greeter',
    adapter: agent({ 'specs/bad.md': 'no title\n', 'objective/RESPONSE.json': '{"resolved":[],"gaps":[{"topic":"T","question":"Who?","default":"devs"}]}' }),
  });
  assert.equal(res.status, 'incomplete');
  assert.match(res.reason ?? '', /waiting for the owner/);
});

test('interview with a kit: a ready result is ok; it may write objective/', async () => {
  const { repo, config } = sandbox('Build a greeter');
  const res = await runInterview({
    config, repoDir: repo, runId: 'r1', identity, objective: 'Build a greeter',
    adapter: agent({
      'specs/greet.md': goodSpec,
      'objective/OPEN-QUESTIONS.md': '# Open questions\n\n- [x] Locale? Out of scope.\n',
    }),
  });
  assert.equal(res.status, 'ok', JSON.stringify(res));
  assert.deepEqual(checkReadiness(repo), { ready: true, gaps: [] });
});

test('run is gated until the objective is ready (no agent call)', async () => {
  const { repo, config } = sandbox('Build a greeter');
  let called = 0;
  const adapter = { async run() { called++; return { transcript: '', usage: { tokens: 0, cost: 0 }, exitStatus: 0, changedFiles: [] }; } };
  const res = await runLoop({ config, repoDir: repo, runId: 'r1', adapter, identity, requireTestPlan: true });
  assert.equal(res.status, 'gated');
  assert.match(String(res.reason), /not ready/);
  assert.equal(called, 0);
});

test('hodgepodge ready reports gaps then ready', async () => {
  const dir = fresh();
  assert.equal(initSandbox({ dir, ...base }).ok, true);
  /** @type {string[]} */
  const outs = [];
  const run = async (/** @type {string[]} */ args) => {
    outs.length = 0;
    const code = await main(args, { stdout: (s) => outs.push(s), stderr: (s) => outs.push(s) });
    return { code, out: outs.join('') };
  };
  const notReady = await run(['ready', '--dir', dir]);
  assert.equal(notReady.code, 1);
  assert.equal(JSON.parse(notReady.out).ready, false);
  const repo = join(dir, 'target');
  mkdirSync(join(repo, 'specs'));
  writeFileSync(join(repo, 'specs', 'greet.md'), goodSpec);
  const ok = await run(['ready', '--dir', dir]);
  assert.equal(ok.code, 0, ok.out);
  assert.deepEqual(JSON.parse(ok.out), { ready: true, gaps: [] });
});

test('kit files live under templates/objective (shipped in the image)', () => {
  for (const f of [...KIT, 'plan.md']) assert.ok(existsSync(join(root, 'templates', 'objective', f)), f);
});

test('hodge in an objective-kit sandbox asks for the objective and is gated without one', async () => {
  const dir = fresh();
  assert.equal((await main(['init', '--dir', dir, '--adapter', 'a', '--model', 'm', '--seed', 'objective'], { stdout: () => {}, stderr: () => {} })), 0);
  let out = '';
  const code = await main(['hodge', '--dir', dir], {
    registry: { a: () => ({ run: async () => { throw new Error('agent must not run without an objective'); } }) },
    input: Readable.from(['']),
    stdout: (s) => (out += s),
    stderr: () => {},
  });
  assert.equal(code, 1);
  assert.match(out, /Describe the objective/);
  assert.match(out, /no objective description given/);
});

test('objective seed package.json has a test script so the tests gate can run', () => {
  const dir = fresh();
  assert.equal(initSandbox({ dir, ...base }).ok, true);
  const pkg = JSON.parse(readFileSync(join(dir, 'target', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js');
});
