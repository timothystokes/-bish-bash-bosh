import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { createCopilotAdapter } from '../src/adapters/copilot.js';
import { commitProjectConfig, withCwd } from './support/project.js';

const here = dirname(fileURLToPath(import.meta.url));
const fakeAgent = join(here, 'fixtures', 'fake-copilot.js');
// A nested `node --test` inherits the outer runner's context and reports green; targets must run standalone.
delete process.env.NODE_TEST_CONTEXT;

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

/** @param {object} fixture */
const scripted = (fixture) => () =>
  createCopilotAdapter({ command: process.execPath, prefixArgs: [fakeAgent], env: { FAKE_AGENT_FIXTURE: JSON.stringify(fixture) } });

/**
 * @param {string[]} argv
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

const budgets = { maxWallClockSeconds: 60, maxIterations: 3 };
/** @param {Record<string, unknown>} extra */
const makeConfig = (extra) => ({ budgets, allowedPaths: ['src/', 'package.json'], ...extra });
const pkg = JSON.stringify({ name: 'toy', type: 'module', scripts: { test: 'node --test tests/*.test.js' } });

test('phase 4 exit: code -> specs -> clean-room rebuild -> conformance suite passes', async () => {
  // existing project with code only
  const source = mkdtempSync(join(tmpdir(), 'hodge-p4-src-'));
  git(source, 'init', '-q', '-b', 'main');
  git(source, 'config', 'user.email', 't@example.com');
  git(source, 'config', 'user.name', 'T');
  mkdirSync(join(source, 'src'));
  writeFileSync(join(source, 'package.json'), pkg);
  writeFileSync(join(source, 'src', 'greet.js'), 'export const greet = (n) => `hello ${n}`;\n');
  git(source, 'add', '-A');
  git(source, 'commit', '-qm', 'existing project');

  // 1. reverse: specs + green characterization tests, nothing else
  const reverseFixture = {
    exitStatus: 0,
    transcript: 'wrote specs and characterization tests',
    writes: {
      'specs/greet.md': '# Spec: greet(name) returns a greeting\nImplementation: none\n\n## Purpose\nGreet a person.\n\n## Requirements\n- R-greet-1: greet(name) returns "hello <name>"\n',
      'tests/PLAN.md': '- specs/greet.md -> tests/greet.test.js: greeting text\n- R-greet-1 -> tests/greet.test.js\n',
      'tests/greet.test.js':
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from '../src/greet.js';\ntest('R-greet-1 greeting', () => assert.equal(greet('bob'), 'hello bob'));\n",
    },
  };
  const srcCfg = makeConfig({ roles: { build: { adapter: 'reverser', model: 'm' }, reverse: { adapter: 'reverser', model: 'm' } } });
  commitProjectConfig(source, srcCfg);
  const rev = await withCwd(source, () => hodge(['hodge', '--reverse', '--run-id', 'p4r'], { reverser: scripted(reverseFixture) }));
  assert.equal(rev.res.status, 'ok', JSON.stringify(rev.res));
  assert.equal(rev.code, 0);
  assert.equal(git(source, 'status', '--porcelain'), '');

  // 2. clean-room export: builder repo holds specs + tests only
  const builder = join(mkdtempSync(join(tmpdir(), 'hodge-p4-b-')), 'builder');
  const exp = await hodge(['clean-room', '--source', source, '--repo', builder], {});
  assert.equal(exp.res.ok, true, JSON.stringify(exp.res));
  assert.equal(exp.code, 0);
  assert.deepEqual(git(builder, 'ls-files').split('\n').sort(), ['specs/greet.md', 'tests/PLAN.md', 'tests/greet.test.js']);
  assert.equal(existsSync(join(builder, 'src')), false);
  git(builder, 'config', 'user.email', 't@example.com');
  git(builder, 'config', 'user.name', 'T');

  // 3. rebuild from specs + tests only; the conformance suite must go green
  const buildFixture = {
    exitStatus: 0,
    transcript: 'implemented greet from the spec',
    writes: { 'plan.md': '- [x] implement greet\n', 'package.json': pkg, 'src/greet.js': 'export const greet = (name) => "hello " + name;\n' },
  };
  const bCfg = makeConfig({ mode: 'clean-room', roles: { build: { adapter: 'builder', model: 'm' } } });
  commitProjectConfig(builder, bCfg);
  const run = await withCwd(builder, () => hodge(['podge', '--run-id', 'p4b'], { builder: scripted(buildFixture) }));
  assert.equal(run.res.status, 'done', JSON.stringify(run.res));
  assert.equal(run.code, 0);

  // the conformance suite (the exported tests, unchanged) passes against the rebuild
  execFileSync('npm', ['test', '--silent'], { cwd: builder, stdio: 'pipe' });
  assert.equal(git(builder, 'status', '--porcelain'), '');
  // the firewall held: the builder's root commit holds no source
  assert.equal(git(builder, 'show', '--name-only', '--format=', git(builder, 'rev-list', '--max-parents=0', 'HEAD')).split('\n').some((f) => f.startsWith('src/')), false);
});
