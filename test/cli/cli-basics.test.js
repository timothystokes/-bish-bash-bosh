import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { parse as parseYaml } from 'yaml';
import { main, parseStepArgs } from '../../src/cli/cli.js';
import { resolveAdapter } from '../../src/adapters/index.js';
import { createFakeAdapter } from '../../src/adapters/adapter.js';
import { freshDir, initGitRepo, commitProjectConfig, withCwd } from '../support/project.js';
import { createTerminalFooter } from '../../src/cli/cli-lib.js';
import {
  formatBuildLoopResult,
  formatInterviewLoopResult,
  formatPlanLoopResult,
  formatReverseResult,
} from '../../src/cli/cli-format.js';

const cfg = (/** @type {string} */ adapter) => ({
  adapter,
  model: 'm',
});

/** @param {string[]} chunks */
const capture = (chunks) => (/** @type {string} */ s) => { chunks.push(s); };

test('all phase result formatters use the same completion banner', () => {
  const results = [
    [formatInterviewLoopResult({ status: 'ok', answered: 1 }), '-bish | Interview'],
    [formatPlanLoopResult({ items: 1, open: 1 }), '-bash | Plan'],
    [formatBuildLoopResult({ status: 'ok', processed: 1 }), '-bosh | Build'],
    [formatReverseResult({ status: 'ok', sha: 'abcdefg' }), '-bish | Reverse'],
  ];
  const rule = '-'.repeat(48);

  for (const [result, phase] of results) {
    assert.ok(result.startsWith(`\n${rule}\n${phase}\n`));
    assert.ok(result.trimEnd().endsWith(rule));
  }
});

test('main pins the branded settings footer for every phase command', async () => {
  const dir = initGitRepo(freshDir('cli-footer-'));
  commitProjectConfig(dir, { adapter: 'f', model: 'm' });
  const screen = [];
  const terminalOutput = Object.assign(new Writable({
    write(chunk, _encoding, callback) {
      screen.push(String(chunk));
      callback();
    },
  }), { isTTY: true, rows: 24, columns: 80 });

  const phases = [
    ['bish', ['--invalid'], 'Interview', 31],
    ['bish', ['--reverse', '--invalid'], 'Reverse', 31],
    ['bash', [], 'Plan', 32],
    ['bosh', [], 'Build', 34],
  ];
  for (const [command, args, mode, color] of phases) {
    screen.length = 0;
    const input = Object.assign(new Readable({ read() {} }), { isTTY: true });
    const code = await withCwd(dir, () => main([command, ...args], {
      input,
      terminalOutput,
      stdout: () => {},
      stderr: (s) => screen.push(s),
    }));
    assert.equal(code, 2);
    const text = screen.join('');
    assert.ok(text.includes(`\x1b[1m\x1b[${color}m-${command}\x1b[22m`), `${command} is bold`);
    assert.ok(text.includes(`Mode: ${mode}`), `${mode} mode is visible`);
    assert.match(text, /Accuracy: 5 \| Curiosity: 4/);
    assert.match(text, /Esc settings/);
    const errorIndex = text.indexOf('unknown argument');
    if (command === 'bish') assert.ok(text.lastIndexOf(`Mode: ${mode}`) > errorIndex, 'footer redraws after the bish error');
    assert.match(text, /\x1b\[r\x1b\[24;1H\x1b\[2K/, `${command} removes the footer before returning`);
  }
});

test('the footer accepts Escape and setting keys outside a readline prompt', () => {
  const input = Object.assign(new Readable({ read() {} }), {
    isTTY: true,
    isRaw: false,
    setRawMode(value) { this.isRaw = value; },
  });
  const screen = [];
  const output = Object.assign(new Writable({ write(chunk, _encoding, callback) { screen.push(String(chunk)); callback(); } }), { rows: 24, columns: 80 });
  const settings = { accuracy: 5, curiosity: 4 };
  const footer = createTerminalFooter(input, output, {
    get: () => settings,
    adjust: (name, delta) => { settings[name] += delta; },
  }, { command: 'bash', mode: 'Plan' });

  footer.show();
  input.emit('keypress', undefined, { name: 'escape' });
  input.emit('keypress', undefined, { name: 'up' });
  input.emit('keypress', undefined, { name: 'escape' });

  assert.deepEqual(settings, { accuracy: 6, curiosity: 4 });
  assert.match(screen.join(''), /Mode: Plan/);
  footer.remove();
  assert.equal(input.isRaw, false, 'terminal input mode is restored');
});

test('settings adjusted from the footer persist while another phase is running', async () => {
  const dir = initGitRepo(freshDir('cli-settings-'));
  commitProjectConfig(dir, { adapter: 'f', model: 'm' });
  const configPath = join(dir, '.bish-bash-bosh', 'config.yml');
  const planPath = join(dir, '.bish-bash-bosh', 'plan.md');
  writeFileSync(join(dir, '.bish-bash-bosh', 'specification.md'), '# Specification\n\n1. [ ] C: Work. B: Useful.\n');
  const input = Object.assign(new Readable({ read() {} }), { isTTY: true });
  const screen = [];
  const terminalOutput = Object.assign(new Writable({ write(chunk, _encoding, callback) { screen.push(String(chunk)); callback(); } }), { isTTY: true, rows: 24, columns: 80 });
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let releaseAgent;
  const gate = new Promise((resolve) => { releaseAgent = resolve; });
  const adapter = {
    run: async () => {
      markStarted();
      await gate;
      writeFileSync(planPath, '# Plan\n\n1. [ ] T: Do work - useful S: 1\n');
      return { exitStatus: 0, transcript: '', changedFiles: [] };
    },
  };
  const run = withCwd(dir, () => main(['bash'], {
    registry: { f: () => adapter },
    input,
    terminalOutput,
    stdout: () => {},
    stderr: () => {},
  }));

  await started;
  input.emit('keypress', undefined, { name: 'escape' });
  input.emit('keypress', undefined, { name: 'up' });
  input.emit('keypress', undefined, { name: 'escape' });
  assert.equal(parseYaml(readFileSync(configPath, 'utf8')).accuracy, 6);
  releaseAgent();
  assert.equal(await run, 0);
});

test('parseStepArgs takes no flags and applies defaults', () => {
  assert.deepEqual(parseStepArgs([]), { ok: true, runId: 'default' });
});

test('parseStepArgs rejects any unknown flag', () => {
  assert.equal(parseStepArgs(['--control', 'x']).ok, false);
  assert.equal(parseStepArgs(['--bogus', 'x']).ok, false);
});

test('resolveAdapter maps the configured adapter id through the registry', () => {
  const fake = createFakeAdapter({ exitStatus: 0, transcript: '', writes: {} });
  const a = resolveAdapter(cfg('f'), { f: () => fake });
  assert.equal(a, fake);
});

test('resolveAdapter passes the configured model to the factory', () => {
  /** @type {string | undefined} */
  let seen;
  resolveAdapter(cfg('f'), { f: ({ model }) => { seen = model; return /** @type {any} */ ({}); } });
  assert.equal(seen, 'm');
});

test('resolveAdapter throws on an unknown adapter id', () => {
  assert.throws(() => resolveAdapter(cfg('nope'), {}), /unknown adapter 'nope'/);
});

test('debugAdapter wraps run() with prompt/exit/transcript logging when debug is on, and is a pass-through otherwise', async () => {
  const { debugAdapter } = await import('../../src/cli/cli-lib.js');
  const inner = {
    run: async (req) => {
      req.onOutput?.('stdout', 'building...');
      return { exitStatus: 0, changedFiles: ['a.js'], transcript: 'done' };
    },
  };
  const out = /** @type {string[]} */ ([]);
  const wrapped = debugAdapter(inner, 'build', true, capture(out));
  await wrapped.run({ prompt: 'do the thing', cwd: '/tmp/x', limits: { seconds: 5 } });
  const text = out.join('');
  assert.match(text, /\[debug\] build: agent start \(cwd \/tmp\/x, seconds=5\)/);
  assert.match(text, /\[debug\] build: prompt begin\ndo the thing\n\[debug\] build: prompt end/);
  assert.match(text, /building\.\.\./);
  assert.match(text, /\[debug\] build: exit 0, changed: a\.js/);
  assert.match(text, /\[debug\] build: transcript begin\ndone\n\[debug\] build: transcript end/);

  assert.equal(debugAdapter(inner, 'build', false, capture(out)), inner, 'debug off: the adapter is returned unwrapped');
});
