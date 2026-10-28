import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { readRunDetails } from '../src/run-details.js';
import { sandboxOf } from './support/sandbox.js';

// A nested `node --test` inherits the outer runner's context and reports green; the target must run standalone.
delete process.env.NODE_TEST_CONTEXT;

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

const SCHEMA = JSON.stringify({ type: 'object', required: ['message'], properties: { message: { type: 'string' } }, additionalProperties: false });
const SPEC = [
  '# Spec: greet',
  'Implementation: none',
  '',
  '## Purpose',
  'Greet a user by name.',
  '',
  '## Requirements',
  '- R-greet-1: `greet` must return "hello <name>" for a non-empty name.',
  '- R-greet-2: the published greeting in out/greeting.json must conform to schemas/greeting.schema.json.',
  '- R-greet-3: `greet` must trim surrounding whitespace from the name.',
  '',
  '## Formats',
  '- json-schema: schemas/greeting.schema.json -> out/greeting.json',
  '',
  '## Out of scope',
  '- Localisation.',
  '',
].join('\n');
const TESTS = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { greet } from '../src/greet.js';",
  "test('R-greet-1 greets', () => assert.equal(greet('ann'), 'hello ann'));",
  "test('R-greet-2 published greeting', () => assert.equal(greet('ann'), 'hello ann'));",
  "test('R-greet-3 trims', () => assert.equal(greet(' ann '), 'hello ann'));",
  '',
].join('\n');
const PLAN_MD = [
  '# Test plan',
  '- specs/greet.md -> tests/greet.test.js: greeting behaviour',
  '- R-greet-1, R-greet-2, R-greet-3 -> tests/greet.test.js',
  '',
].join('\n');
const GREET_OK = "export const greet = (n) => `hello ${n.trim()}`;\n";
const GOOD_OUT = `${JSON.stringify({ message: 'hello ann' })}\n`;

/** @param {{tests?: string, planMd?: string}} [o] */
function makeTarget({ tests = TESTS, planMd = PLAN_MD } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-p6-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  for (const d of ['specs', 'tests', 'schemas']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'toy', type: 'module', scripts: { test: 'node --test tests/*.test.js' } }));
  writeFileSync(join(dir, 'specs', 'greet.md'), SPEC);
  writeFileSync(join(dir, 'schemas', 'greeting.schema.json'), SCHEMA);
  writeFileSync(join(dir, 'tests', 'PLAN.md'), planMd);
  writeFileSync(join(dir, 'tests', 'greet.test.js'), tests);
  writeFileSync(join(dir, 'plan.md'), '- [ ] implement greet\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'spec, schema, red tests, plan');
  return dir;
}

const cfg = (extra = {}) => ({
  targetRepo: 'git@example.com:o/toy.git',
  roles: { build: { adapter: 'builder', model: 'm' }, qa: { adapter: 'checker', model: 'm2' } },
  budgets: { maxWallClockSeconds: 120, maxIterations: 4 },
  allowedPaths: ['src/', 'out/'],
  requireTestPlan: true,
  ...extra,
});

const result = (/** @type {string} */ transcript) => ({ exitStatus: 0, transcript, changedFiles: [] });
const findingsBlock = (/** @type {unknown[]} */ f) => `report\n\`\`\`findings\n${JSON.stringify(f)}\n\`\`\`\n`;
const FINDING = {
  classification: 'unimplemented-requirement',
  severity: 'high',
  spec: 'specs/greet.md',
  consequence: 'the published greeting out/greeting.json does not exist',
  diagnosis: { rootCause: 'output never generated', evidence: 'ls out/', fix: 'write out/greeting.json', test: 'R-greet-2 published greeting', prevention: 'check declared outputs exist' },
};

/**
 * Scripted, stateful role adapter: each call runs the next handler (the last one repeats).
 * @param {((cwd: string) => string)[]} handlers a handler may write files and returns the transcript
 */
function scripted(handlers) {
  let n = 0;
  return {
    calls: () => n,
    adapter: {
      async run(/** @type {{cwd: string}} */ req) {
        const h = handlers[Math.min(n, handlers.length - 1)];
        n += 1;
        return result(h(req.cwd));
      },
    },
  };
}

/** @param {string} cwd @param {Record<string, string>} files */
function put(cwd, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(cwd, rel, '..'), { recursive: true });
    writeFileSync(join(cwd, rel), content);
  }
}
const tickAll = (/** @type {string} */ cwd) => put(cwd, { 'plan.md': readFileSync(join(cwd, 'plan.md'), 'utf8').replaceAll('[ ]', '[x]') });

/**
 * @param {string} cmd
 * @param {string} dir
 * @param {object} config
 * @param {Record<string, any>} registry
 */
async function run(cmd, dir, config, registry) {
  /** @type {string[]} */
  const outs = [];
  const sandbox = sandboxOf(config, dir);
  const code = await main([cmd, '--dir', sandbox, '--run-id', 'p6'], {
    registry,
    identity: { root: '/nonexistent/hodgepodge', remotes: [] },
    stdout: (s) => outs.push(s),
    stderr: () => {},
  });
  return { code, sandbox, res: JSON.parse(outs.join('')) };
}

test('phase 6 regression: lint, formats, scripted build, derived done, QA cycle, evidence, lock', async () => {
  const dir = makeTarget();
  const build = scripted([
    (cwd) => {
      put(cwd, { 'src/greet.js': GREET_OK });
      tickAll(cwd);
      return 'implemented greet';
    },
    (cwd) => {
      put(cwd, { 'out/greeting.json': GOOD_OUT });
      tickAll(cwd);
      return 'fixed the QA finding';
    },
  ]);
  const qa = scripted([() => findingsBlock([FINDING]), () => findingsBlock([])]);
  const { code, sandbox, res } = await run('podge', dir, cfg(), { builder: () => build.adapter, checker: () => qa.adapter });

  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.equal(code, 0);
  assert.equal(build.calls(), 2, 'one build step, one to fix the QA item');
  assert.equal(qa.calls(), 2);
  assert.deepEqual(res.qa.map((/** @type {any} */ q) => q.status), ['findings', 'clean']);

  execFileSync('npm', ['test', '--silent'], { cwd: dir, stdio: 'pipe' });
  assert.equal(git(dir, 'status', '--porcelain'), '');

  const done = JSON.parse(readFileSync(join(dir, 'runs', 'p6', 'done.json'), 'utf8'));
  assert.equal(done.ok, true);
  assert.deepEqual(done.requirements.map((/** @type {any} */ r) => [r.id, r.status]), [
    ['R-greet-1', 'passing'],
    ['R-greet-2', 'passing'],
    ['R-greet-3', 'passing'],
  ]);
  assert.match(readFileSync(join(dir, 'specs', 'greet.md'), 'utf8'), /^# Spec: greet\nImplementation: implemented\nEvidence: /);

  assert.deepEqual(readdirSync(join(dir, 'runs', 'p6')).filter((f) => f.startsWith('qa-')).sort(), ['qa-1', 'qa-2']);
  const f1 = JSON.parse(readFileSync(join(dir, 'runs', 'p6', 'qa-1', 'findings.json'), 'utf8'));
  assert.equal(f1[0].diagnosis.rootCause, 'output never generated');
  assert.match(readFileSync(join(dir, 'plan.md'), 'utf8'), /- \[x\] QA-1-1/);

  const details = readRunDetails(dir, 'p6');
  assert.deepEqual(details.formats?.map((/** @type {any} */ d) => d.format), ['json-schema']);
  assert.equal(details.qa?.length, 2);
  assert.equal(details.done?.ok, true);
  assert.equal(existsSync(join(sandbox, '.hodge.lock')), false, 'the run lock is released');
});

test('phase 6 regression: an output that does not conform to the declared schema is stopped by the formats gate with a diagnosis', async () => {
  const dir = makeTarget();
  const build = scripted([
    (cwd) => {
      put(cwd, { 'src/greet.js': GREET_OK, 'out/greeting.json': `${JSON.stringify({ msg: 'hello ann' })}\n` });
      tickAll(cwd);
      return 'implemented greet';
    },
  ]);
  const qa = scripted([() => findingsBlock([])]);
  const { code, res } = await run('podge', dir, cfg(), { builder: () => build.adapter, checker: () => qa.adapter });

  assert.equal(res.status, 'failed', JSON.stringify(res));
  assert.match(res.reason, /gate formats failed/);
  assert.equal(code, 1);
  assert.equal(qa.calls(), 0, 'QA never runs on a gated build');
  assert.equal(existsSync(join(dir, 'out', 'greeting.json')), false, 'the non-conforming output is not kept');
  assert.equal(git(dir, 'status', '--porcelain'), '');
  const rec = JSON.parse(readFileSync(join(dir, 'runs', 'p6', 'iterations', '001', 'record.json'), 'utf8'));
  assert.equal(rec.status, 'failed');
  assert.ok(rec.gates.some((/** @type {any} */ g) => g.name === 'formats' && g.ok === false), JSON.stringify(rec.gates));
  const diag = JSON.parse(readFileSync(join(dir, 'runs', 'p6', 'iterations', '001', 'diagnosis.json'), 'utf8'));
  assert.equal(diag.rootCause, 'gate formats failed');
  assert.match(diag.evidence, /greeting\.json/);
});

test('phase 6 regression: a requirement with no passing test keeps a ticked plan from being done, and QA never runs', async () => {
  const dir = makeTarget({
    tests: TESTS.replace("test('R-greet-3 trims'", "test('trims'"),
  });
  // red-first: R-greet-3 has no named test, so the suite is green once greet exists but the requirement is unproven
  const build = scripted([
    (cwd) => {
      put(cwd, { 'src/greet.js': GREET_OK, 'out/greeting.json': GOOD_OUT });
      tickAll(cwd);
      return 'implemented greet';
    },
  ]);
  const qa = scripted([() => findingsBlock([])]);
  const { res } = await run('podge', dir, cfg({ budgets: { maxWallClockSeconds: 120, maxIterations: 2 } }), {
    builder: () => build.adapter,
    checker: () => qa.adapter,
  });

  assert.notEqual(res.status, 'done', JSON.stringify(res));
  assert.equal(qa.calls(), 0);
  assert.match(readFileSync(join(dir, 'plan.md'), 'utf8'), /- \[ \] Verify: R-greet-3: no passing test/);
  const done = JSON.parse(readFileSync(join(dir, 'runs', 'p6', 'done.json'), 'utf8'));
  assert.equal(done.ok, false);
});

test('phase 6 regression: spec-lint stops podge before any agent call when a requirement has no mapped test', async () => {
  const dir = makeTarget({ planMd: '# Test plan\n- specs/greet.md -> tests/greet.test.js: greeting behaviour\n' });
  const build = scripted([() => 'should not run']);
  const { code, res } = await run('podge', dir, cfg(), { builder: () => build.adapter, checker: () => scripted([() => findingsBlock([])]).adapter });
  assert.equal(res.status, 'gated', JSON.stringify(res));
  assert.equal(code, 1);
  assert.match(res.reason, /spec-lint failed.*R-greet-1/);
  assert.equal(build.calls(), 0);
});

test('phase 6 regression: a second run in the same sandbox is refused while the first holds the lock', async () => {
  const dir = makeTarget();
  const sandbox = sandboxOf(cfg(), dir);
  writeFileSync(join(sandbox, '.hodge.lock'), `${process.pid}\n`);
  /** @type {string[]} */
  const errs = [];
  const code = await main(['podge', '--dir', sandbox, '--run-id', 'p6'], {
    registry: { builder: () => scripted([() => 'x']).adapter, checker: () => scripted([() => findingsBlock([])]).adapter },
    identity: { root: '/nonexistent/hodgepodge', remotes: [] },
    stdout: () => {},
    stderr: (s) => errs.push(s),
  });
  assert.notEqual(code, 0);
  assert.match(errs.join(''), /lock|already running/i);
  assert.equal(readdirSync(join(dir)).includes('runs'), false);
});
