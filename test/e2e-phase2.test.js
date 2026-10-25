import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { createCopilotAdapter } from '../src/adapters/copilot.js';

const here = dirname(fileURLToPath(import.meta.url));
const fakeAgent = join(here, 'fixtures', 'fake-copilot.js');
// A nested `node --test` inherits the outer runner's context and reports green; the target must run standalone.
delete process.env.NODE_TEST_CONTEXT;

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

/** @param {object} fixture */
const scripted = (fixture) => () =>
  createCopilotAdapter({ command: process.execPath, prefixArgs: [fakeAgent], env: { FAKE_AGENT_FIXTURE: JSON.stringify(fixture) } });

/**
 * @param {string[]} argv
 * @param {Record<string, () => import('../src/adapter.js').Adapter>} registry
 */
async function hodge(argv, registry) {
  /** @type {string[]} */
  const outs = [];
  const code = await main(argv, {
    registry,
    identity: { root: '/nonexistent/hodgepodge', remotes: [] },
    stdout: (s) => outs.push(s),
    stderr: () => {},
  });
  return { code, res: JSON.parse(outs.join('')) };
}

test('phase 2 exit: objective goes interview -> specs -> test plan -> forward loop -> green', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-p2-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'toy', type: 'module', scripts: { test: 'node --test tests/*.test.js' } }));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'empty target');

  const cfgPath = join(mkdtempSync(join(tmpdir(), 'hodge-cfg-')), 'hodge.json');
  writeFileSync(
    cfgPath,
    JSON.stringify({
      targetRepo: 'git@example.com:o/toy.git',
      roles: { interview: { adapter: 'interviewer', model: 'm' }, build: { adapter: 'builder', model: 'm' } },
      budgets: { maxTokens: 10000, maxCostUsd: 1, maxWallClockSeconds: 60, maxIterations: 3 },
      allowedPaths: ['src/'],
      requireTestPlan: true,
    }),
  );

  const interviewFixture = {
    exitStatus: 0,
    transcript: 'wrote specs and tests',
    usage: { tokens: 10, cost: 0.01 },
    writes: {
      'specs/add.md': '# Spec: add(a, b) returns the sum\n\n## Purpose\nAdd two numbers.\n',
      'tests/PLAN.md': '- specs/add.md -> tests/add.test.js: sum of two numbers\n',
      'tests/add.test.js':
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.js';\ntest('add', () => assert.equal(add(2, 3), 5));\n",
    },
  };
  const buildFixture = {
    exitStatus: 0,
    transcript: 'implemented add',
    usage: { tokens: 10, cost: 0.01 },
    writes: {
      'src/add.js': 'export const add = (a, b) => a + b;\n',
      'plan.md': '- [x] implement add\n',
    },
  };
  const registry = { interviewer: scripted(interviewFixture), builder: scripted(buildFixture) };

  // 1. interview: specs + red tests committed, spec-lint passes
  const iv = await hodge(['interview', '--config', cfgPath, '--objective', 'add two numbers', '--repo', dir, '--run-id', 'p2'], registry);
  assert.equal(iv.res.status, 'ok', JSON.stringify(iv.res));
  assert.equal(iv.code, 0);
  assert.ok(existsSync(join(dir, 'specs', 'add.md')));
  assert.ok(existsSync(join(dir, 'tests', 'PLAN.md')));
  const lint = await hodge(['spec-lint', '--repo', dir], registry);
  assert.equal(lint.res.ok, true);
  assert.equal(git(dir, 'status', '--porcelain'), '');

  // 2. the plan is the owner's/orchestrator's; interview may not write it
  writeFileSync(join(dir, 'plan.md'), '- [ ] implement add\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'plan');

  // 3. forward loops: tests red first, then green
  const run = await hodge(['run', '--config', cfgPath, '--repo', dir, '--run-id', 'p2'], registry);
  assert.equal(run.res.status, 'done', JSON.stringify(run.res));
  assert.equal(run.code, 0);
  assert.equal(run.res.steps.length, 1);

  execFileSync('npm', ['test', '--silent'], { cwd: dir, stdio: 'pipe' });
  assert.equal(git(dir, 'status', '--porcelain'), '');
  const rec = JSON.parse(readFileSync(join(dir, 'runs', 'p2', 'iterations', '001', 'record.json'), 'utf8'));
  assert.equal(rec.status, 'ok');
});
