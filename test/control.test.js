import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readControl, consumeSteer } from '../src/control.js';
import { runLoop } from '../src/podge-driver.js';
import { buildPrompt } from '../src/podge-step.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-ctl-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  mkdirSync(join(dir, 'specs'));
  writeFileSync(join(dir, 'specs', 'a.md'), '# Spec: A\n');
  writeFileSync(join(dir, 'plan.md'), '- [ ] one\n- [ ] two\n- [ ] three\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const config = {
  roles: { build: { adapter: 'f', model: 'm' } },
  allowedPaths: ['src/'],
};
const identity = { root: '/nonexistent/hodgepodge', remotes: [] };
const pass = ['node', '-e', 'process.exit(0)'];

/** @param {string[]} prompts */
function recordingAdapter(prompts) {
  return {
    async run(/** @type {any} */ req) {
      prompts.push(req.prompt);
      const n = prompts.length;
      mkdirSync(join(req.cwd, 'src'), { recursive: true });
      writeFileSync(join(req.cwd, 'src', `f${n}.txt`), 'x');
      return { exitStatus: 0, transcript: 't', changedFiles: [] };
    },
  };
}

const ctlFile = () => join(mkdtempSync(join(tmpdir(), 'hodge-ctlf-')), 'control.json');

test('readControl: missing file means running with no note', () => {
  assert.deepEqual(readControl(ctlFile()), { ok: true, paused: false, stop: false });
});

test('readControl parses pause, stop and steer', () => {
  const f = ctlFile();
  writeFileSync(f, JSON.stringify({ paused: true, stop: true, steer: 'focus on parsing' }));
  assert.deepEqual(readControl(f), { ok: true, paused: true, stop: true, steer: 'focus on parsing' });
});

test('readControl fails closed on invalid JSON or wrong types', () => {
  const f = ctlFile();
  writeFileSync(f, '{nope');
  assert.equal(readControl(f).ok, false);
  writeFileSync(f, JSON.stringify({ paused: 'yes' }));
  assert.equal(readControl(f).ok, false);
  writeFileSync(f, JSON.stringify({ steer: 5 }));
  assert.equal(readControl(f).ok, false);
});

test('consumeSteer removes only the matching note and keeps other fields', () => {
  const f = ctlFile();
  writeFileSync(f, JSON.stringify({ paused: false, steer: 'a' }));
  consumeSteer(f, 'a');
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { paused: false });
  writeFileSync(f, JSON.stringify({ steer: 'newer' }));
  consumeSteer(f, 'a');
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).steer, 'newer');
});

test('buildPrompt appends a steer note when given', () => {
  const dir = makeRepo();
  assert.doesNotMatch(buildPrompt(dir), /Steer note/);
  assert.match(buildPrompt(dir, 'forward', 'use tabs'), /## Steer note[\s\S]*use tabs/);
});

test('runLoop stops with status stopped when control says stop, before any step', async () => {
  const dir = makeRepo();
  const f = ctlFile();
  writeFileSync(f, JSON.stringify({ stop: true }));
  const prompts = /** @type {string[]} */ ([]);
  const res = await runLoop({ config, repoDir: dir, runId: 'r', adapter: recordingAdapter(prompts), testCommand: pass, identity, controlFile: f });
  assert.equal(res.status, 'stopped');
  assert.deepEqual(res.steps, []);
  assert.equal(prompts.length, 0);
});

test('runLoop stops between iterations when stop appears mid-run', async () => {
  const dir = makeRepo();
  const f = ctlFile();
  const prompts = /** @type {string[]} */ ([]);
  const inner = recordingAdapter(prompts);
  const adapter = {
    async run(/** @type {any} */ req) {
      const r = await inner.run(req);
      writeFileSync(f, JSON.stringify({ stop: true }));
      return r;
    },
  };
  const res = await runLoop({ config, repoDir: dir, runId: 'r', adapter, testCommand: pass, identity, controlFile: f });
  assert.equal(res.status, 'stopped');
  assert.equal(res.steps.length, 1);
});

test('runLoop waits while paused and resumes when unpaused', async () => {
  const dir = makeRepo();
  const f = ctlFile();
  writeFileSync(f, JSON.stringify({ paused: true }));
  const prompts = /** @type {string[]} */ ([]);
  let sleeps = 0;
  const sleep = async () => {
    sleeps += 1;
    if (sleeps === 3) writeFileSync(f, JSON.stringify({ paused: false }));
    assert.equal(prompts.length, 0);
  };
  const inner = recordingAdapter(prompts);
  // Stop the loop after the first step once resumed; the plan fixture never finishes on its own.
  const adapter = {
    async run(/** @type {any} */ req) {
      const r = await inner.run(req);
      writeFileSync(f, JSON.stringify({ stop: true }));
      return r;
    },
  };
  const res = await runLoop({ config, repoDir: dir, runId: 'r', adapter, testCommand: pass, identity, controlFile: f, sleep });
  assert.equal(sleeps, 3);
  assert.equal(prompts.length, 1);
  assert.equal(res.steps.filter((x) => x.status === 'ok').length, 1);
});

test('stop wins while paused', async () => {
  const dir = makeRepo();
  const f = ctlFile();
  writeFileSync(f, JSON.stringify({ paused: true }));
  const sleep = async () => { writeFileSync(f, JSON.stringify({ paused: true, stop: true })); };
  const prompts = /** @type {string[]} */ ([]);
  const res = await runLoop({ config, repoDir: dir, runId: 'r', adapter: recordingAdapter(prompts), testCommand: pass, identity, controlFile: f, sleep });
  assert.equal(res.status, 'stopped');
  assert.equal(prompts.length, 0);
});

test('steer note is injected into exactly the next prompt, then consumed', async () => {
  const dir = makeRepo();
  const f = ctlFile();
  writeFileSync(f, JSON.stringify({ steer: 'prefer small functions' }));
  const prompts = /** @type {string[]} */ ([]);
  const inner = recordingAdapter(prompts);
  // Stop the loop after the second step; the plan fixture never finishes on its own.
  const adapter = {
    async run(/** @type {any} */ req) {
      const r = await inner.run(req);
      if (prompts.length === 2) writeFileSync(f, JSON.stringify({ stop: true }));
      return r;
    },
  };
  const res = await runLoop({ config, repoDir: dir, runId: 'r', adapter, testCommand: pass, identity, controlFile: f });
  assert.equal(res.steps.filter((x) => x.status === 'ok').length, 2);
  assert.match(prompts[0], /prefer small functions/);
  assert.doesNotMatch(prompts[1], /prefer small functions/);
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).steer, undefined);
});

test('invalid control file stops the loop (fail closed)', async () => {
  const dir = makeRepo();
  const f = ctlFile();
  writeFileSync(f, '{bad');
  const prompts = /** @type {string[]} */ ([]);
  const res = await runLoop({ config, repoDir: dir, runId: 'r', adapter: recordingAdapter(prompts), testCommand: pass, identity, controlFile: f });
  assert.equal(res.status, 'stopped');
  assert.match(res.reason ?? '', /control/);
  assert.equal(prompts.length, 0);
});

test('without controlFile behaviour is unchanged and no file is created', async () => {
  const dir = makeRepo();
  const prompts = /** @type {string[]} */ ([]);
  // No controlFile and no run budget: bound the loop by letting the agent finish the plan.
  const adapter = {
    async run(/** @type {any} */ req) {
      prompts.push(req.prompt);
      writeFileSync(join(req.cwd, 'plan.md'), '- [x] one\n- [x] two\n- [x] three\n');
      return { exitStatus: 0, transcript: 't', changedFiles: ['plan.md'] };
    },
  };
  const res = await runLoop({ config, repoDir: dir, runId: 'r', adapter, testCommand: pass, identity });
  assert.equal(res.steps.filter((x) => x.status === 'ok').length, 1);
  assert.equal(existsSync(join(dir, 'control.json')), false);
});

test('writeControl merges updates atomically and preserves other keys', async () => {
  const { writeControl } = await import('../src/control.js');
  const { mkdtempSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const f = join(mkdtempSync(join(tmpdir(), 'hodge-wc-')), 'control.json');
  assert.deepEqual(writeControl(f, { paused: true }), { ok: true });
  assert.deepEqual(writeControl(f, { steer: 'focus' }), { ok: true });
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { paused: true, steer: 'focus' });
  assert.deepEqual(writeControl(f, { paused: false }), { ok: true });
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { paused: false, steer: 'focus' });
  assert.equal(existsSync(`${f}.tmp`), false);
});

test('writeControl refuses to overwrite a malformed control file', async () => {
  const { writeControl } = await import('../src/control.js');
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const f = join(mkdtempSync(join(tmpdir(), 'hodge-wc-')), 'control.json');
  writeFileSync(f, '{nope');
  const r = writeControl(f, { paused: false });
  assert.equal(r.ok, false);
  assert.equal(readFileSync(f, 'utf8'), '{nope');
});
