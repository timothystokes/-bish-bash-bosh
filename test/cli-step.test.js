import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, parseStepArgs } from '../src/cli.js';
import { resolveAdapter } from '../src/adapters/index.js';
import { createFakeAdapter } from '../src/adapter.js';
import { writeProjectConfig, commitProjectConfig, withCwd } from './support/project.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-cli-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  mkdirSync(join(dir, 'specs'));
  writeFileSync(join(dir, 'specs', 'a.md'), '# Spec A\n');
  writeFileSync(join(dir, 'plan.md'), '# plan\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const cfg = (/** @type {string} */ adapter) => ({
  roles: { build: { adapter, model: 'm' } },
  budgets: { maxWallClockSeconds: 60, maxIterations: 5 },
  allowedPaths: ['src/'],
});

/** @param {string[]} chunks */
const capture = (chunks) => (/** @type {string} */ s) => { chunks.push(s); };

test('parseStepArgs reads flags and applies defaults', () => {
  assert.deepEqual(parseStepArgs([]), { ok: true, runId: 'default' });
  assert.deepEqual(parseStepArgs(['--run-id', 'x1']), { ok: true, runId: 'x1' });
});

test('parseStepArgs rejects missing values and unknown flags', () => {
  assert.equal(parseStepArgs(['--run-id']).ok, false);
  assert.equal(parseStepArgs(['--run-id', 'x', '--bogus']).ok, false);
});

test('resolveAdapter maps role adapter id through the registry', () => {
  const fake = createFakeAdapter({ exitStatus: 0, transcript: '', writes: {} });
  const a = resolveAdapter(cfg('f'), 'build', { f: () => fake });
  assert.equal(a, fake);
});

test('resolveAdapter passes the role model to the factory', () => {
  /** @type {string | undefined} */
  let seen;
  resolveAdapter(cfg('f'), 'build', { f: ({ model }) => { seen = model; return /** @type {any} */ ({}); } });
  assert.equal(seen, 'm');
});

test('resolveAdapter throws on unknown adapter id or missing role', () => {
  assert.throws(() => resolveAdapter(cfg('nope'), 'build', {}), /unknown adapter 'nope'/);
  assert.throws(() => resolveAdapter(cfg('f'), 'review', { f: () => /** @type {any} */ ({}) }), /no role 'review'/);
});

test('podge step prints JSON {sha, iteration, status} and exits 0', async () => {
  const dir = makeRepo();
  commitProjectConfig(dir, cfg('f'));
  const out = /** @type {string[]} */ ([]);
  const code = await withCwd(dir, () =>
    main(['podge', 'step', '--run-id', 'r1'], {
      registry: { f: () => createFakeAdapter({ exitStatus: 0, transcript: 'ok', writes: { 'src/a.js': 'x\n' } }) },
      testCommand: ['node', '-e', 'process.exit(0)'],
      identity: { root: '/nonexistent/hodgepodge', remotes: [] },
      stdout: capture(out),
      stderr: () => {},
    }));
  assert.equal(code, 0);
  const res = JSON.parse(out.join(''));
  assert.equal(res.status, 'ok');
  assert.equal(res.iteration, 1);
  assert.deepEqual(Object.keys(res).sort(), ['iteration', 'sha', 'status']);
  assert.equal(res.sha, git(dir, 'rev-parse', 'HEAD'));
});

test('podge step exits non-zero when the step fails or is gated', async () => {
  const dir = makeRepo();
  commitProjectConfig(dir, cfg('f'));
  const out = /** @type {string[]} */ ([]);
  const code = await withCwd(dir, () =>
    main(['podge', 'step', '--run-id', 'r1'], {
      registry: { f: () => createFakeAdapter({ exitStatus: 1, transcript: 'no', writes: {} }) },
      testCommand: ['node', '-e', 'process.exit(0)'],
      identity: { root: '/nonexistent/hodgepodge', remotes: [] },
      stdout: capture(out),
      stderr: () => {},
    }));
  assert.equal(code, 1);
  assert.equal(JSON.parse(out.join('')).status, 'failed');
});

test('podge step reports config problems on stderr with exit 2', async () => {
  const err = /** @type {string[]} */ ([]);
  const missing = await withCwd(mkdtempSync(join(tmpdir(), 'hodge-empty-')), () =>
    main(['podge', 'step'], { stdout: () => {}, stderr: capture(err) }));
  assert.equal(missing, 2);
  assert.match(err.join(''), /cannot read config/);
  assert.match(err.join(''), /hodgepodge\.yml/);

  err.length = 0;
  const badDir = mkdtempSync(join(tmpdir(), 'hodge-bad-'));
  writeFileSync(join(badDir, 'hodgepodge.yml'), 'nope: true\n');
  const bad = await withCwd(badDir, () => main(['podge', 'step'], { stdout: () => {}, stderr: capture(err) }));
  assert.equal(bad, 2);
  assert.match(err.join(''), /invalid config/);
});

test('podge step reports unknown adapter with exit 2', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-cfg-u-'));
  writeProjectConfig(dir, cfg('nope'));
  const err = /** @type {string[]} */ ([]);
  const code = await withCwd(dir, () => main(['podge', 'step'], { registry: {}, stdout: () => {}, stderr: capture(err) }));
  assert.equal(code, 2);
  assert.match(err.join(''), /unknown adapter 'nope'/);
});

test('hodgepodge control writes pause/resume/steer/stop to the control file', async () => {
  const { readFileSync } = await import('node:fs');
  const f = join(mkdtempSync(join(tmpdir(), 'hodge-ctl-')), 'control.json');
  const run = async (/** @type {string[]} */ ...a) => {
    const o = /** @type {string[]} */ ([]);
    const e = /** @type {string[]} */ ([]);
    const code = await main(['control', '--file', f, ...a], { stdout: capture(o), stderr: capture(e) });
    return { code, o: o.join(''), e: e.join('') };
  };
  assert.equal((await run('pause')).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { paused: true });
  assert.equal((await run('steer', 'try', 'X')).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { paused: true, steer: 'try X' });
  assert.equal((await run('resume')).code, 0);
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).paused, false);
  const s = await run('stop');
  assert.equal(s.code, 0);
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).stop, true);
  assert.deepEqual(JSON.parse(s.o), { ok: true });
});

test('hodgepodge control rejects bad usage', async () => {
  const e = /** @type {string[]} */ ([]);
  assert.equal(await main(['control', 'pause'], { stderr: capture(e) }), 2);
  assert.equal(await main(['control', '--file', '/tmp/x.json', 'bogus'], { stderr: capture(e) }), 2);
  assert.equal(await main(['control', '--file', '/tmp/x.json', 'steer'], { stderr: capture(e) }), 2);
  assert.equal(await main(['control', '--file', '/tmp/x.json'], { stderr: capture(e) }), 2);
});

test('podge --control passes the control file so a stop is honoured', async () => {
  const dir = makeRepo();
  const f = join(mkdtempSync(join(tmpdir(), 'hodge-ctl-')), 'control.json');
  writeFileSync(f, JSON.stringify({ stop: true }));
  commitProjectConfig(dir, cfg('fake'));
  const o = /** @type {string[]} */ ([]);
  const code = await withCwd(dir, () =>
    main(['podge', '--control', f], {
      registry: { fake: () => createFakeAdapter({ exitStatus: 0, transcript: '', writes: {} }) },
      stdout: capture(o),
      stderr: capture([]),
    }));
  assert.equal(code, 1);
  assert.equal(JSON.parse(o.join('')).status, 'stopped');
});

test('--debug logs the agent transcript and gate results to stdout; off by default', async () => {
  const run = async (/** @type {string[]} */ extra) => {
    const dir = makeRepo();
    commitProjectConfig(dir, cfg('f'));
    const err = /** @type {string[]} */ ([]);
    const code = await withCwd(dir, () =>
      main(['podge', 'step', '--run-id', 'r1', ...extra], {
        registry: { f: () => createFakeAdapter({ exitStatus: 1, transcript: 'SECRET-LOOKING-TRANSCRIPT', writes: {} }) },
        testCommand: ['node', '-e', 'process.exit(0)'],
        identity: { root: '/nonexistent/hodgepodge', remotes: [] },
        stdout: capture(err),
        stderr: () => {},
      }));
    return { code, err: err.join('') };
  };
  const on = await run(['--debug']);
  assert.equal(on.code, 1);
  assert.match(on.err, /\[debug\] build: exit 1/);
  assert.match(on.err, /SECRET-LOOKING-TRANSCRIPT/);
  assert.match(on.err, /\[debug\] gate tests: FAILED/);
  const off = await run([]);
  assert.doesNotMatch(off.err, /\[debug\]|SECRET-LOOKING/);
});
