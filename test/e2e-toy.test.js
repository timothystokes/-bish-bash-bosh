import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { createCopilotAdapter } from '../src/adapters/copilot.js';
import { sandboxOf } from './support/sandbox.js';

const here = dirname(fileURLToPath(import.meta.url));
const fakeAgent = join(here, 'fixtures', 'fake-copilot.js');
// A nested `node --test` inherits the outer runner's context and reports green; the toy target must run standalone.
delete process.env.NODE_TEST_CONTEXT;

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

/** Toy target: one spec, one red test, plan with one open item. */
function makeToyTarget() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-toy-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  mkdirSync(join(dir, 'specs'));
  mkdirSync(join(dir, 'tests'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'toy', type: 'module', scripts: { test: 'node --test tests/*.test.js' } }));
  writeFileSync(join(dir, 'specs', 'add.md'), '# Spec: add(a, b) returns the sum\n');
  writeFileSync(join(dir, 'tests', 'PLAN.md'), '- specs/add.md -> tests/add.test.js: sum of two numbers\n');
  writeFileSync(
    join(dir, 'tests', 'add.test.js'),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.js';\ntest('add', () => assert.equal(add(2, 3), 5));\n",
  );
  writeFileSync(join(dir, 'plan.md'), '- [ ] implement add\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'toy: spec, red tests, plan');
  return dir;
}

test('toy objective: podge takes a red target to green unattended', async () => {
  const dir = makeToyTarget();
  const cfgPath = join(mkdtempSync(join(tmpdir(), 'hodge-cfg-')), 'hodge.json');
  writeFileSync(
    cfgPath,
    JSON.stringify({
      targetRepo: 'git@example.com:o/toy.git',
      roles: { build: { adapter: 'agent', model: 'm' } },
      budgets: { maxTokens: 10000, maxCostUsd: 1, maxWallClockSeconds: 60, maxIterations: 3 },
      allowedPaths: ['src/'],
      requireTestPlan: true,
    }),
  );
  const fixture = {
    exitStatus: 0,
    transcript: 'implemented add',
    usage: { tokens: 10, cost: 0.01 },
    writes: {
      'src/add.js': 'export const add = (a, b) => a + b;\n',
      'plan.md': '- [x] implement add\n',
    },
  };
  const registry = {
    agent: () =>
      createCopilotAdapter({ command: process.execPath, prefixArgs: [fakeAgent], env: { FAKE_AGENT_FIXTURE: JSON.stringify(fixture) } }),
  };
  /** @type {string[]} */
  const outs = [];
  const code = await main(['podge', '--dir', sandboxOf(cfgPath, dir), '--run-id', 'toy'], {
    registry,
    identity: { root: '/nonexistent/hodgepodge', remotes: [] },
    stdout: (s) => outs.push(s),
    stderr: () => {},
  });
  const res = JSON.parse(outs.join(''));
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.equal(code, 0);
  assert.equal(res.steps.length, 1);
  assert.match(res.steps[0].sha, /^[0-9a-f]{7,}$/);

  // green for real, committed, tree clean, record on disk
  execFileSync('npm', ['test', '--silent'], { cwd: dir, stdio: 'pipe' });
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.ok(existsSync(join(dir, 'runs', 'toy', 'iterations', '001', 'record.json')));
  const rec = JSON.parse(readFileSync(join(dir, 'runs', 'toy', 'iterations', '001', 'record.json'), 'utf8'));
  assert.equal(rec.status, 'ok');
});

test('toy objective: green-from-the-start suite is gated (tests must fail first)', async () => {
  const dir = makeToyTarget();
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'add.js'), 'export const add = (a, b) => a + b;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'already green');
  const cfgPath = join(mkdtempSync(join(tmpdir(), 'hodge-cfg-')), 'hodge.json');
  writeFileSync(
    cfgPath,
    JSON.stringify({
      targetRepo: 'git@example.com:o/toy.git',
      roles: { build: { adapter: 'agent', model: 'm' } },
      budgets: { maxTokens: 10000, maxCostUsd: 1, maxWallClockSeconds: 60, maxIterations: 3 },
      allowedPaths: ['src/'],
      requireTestPlan: true,
    }),
  );
  /** @type {string[]} */
  const outs = [];
  const code = await main(['podge', '--dir', sandboxOf(cfgPath, dir), '--run-id', 'toy'], {
    registry: { agent: () => createCopilotAdapter({ command: process.execPath, prefixArgs: [fakeAgent] }) },
    identity: { root: '/nonexistent/hodgepodge', remotes: [] },
    stdout: (s) => outs.push(s),
    stderr: () => {},
  });
  assert.equal(JSON.parse(outs.join('')).status, 'gated');
  assert.equal(code, 1);
});
