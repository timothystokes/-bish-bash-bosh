import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, helpText, parseStepArgs } from '../src/cli.js';

/** @param {string[]} args */
async function run(args) {
  /** @type {string[]} */
  const outs = [];
  /** @type {string[]} */
  const errs = [];
  const code = await main(args, { stdout: (s) => outs.push(s), stderr: (s) => errs.push(s) });
  return { code, out: outs.join(''), err: errs.join('') };
}

const sandbox = async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'cli-dir-')), 'sb');
  const init = await run(['init', '--dir', dir, '--adapter', 'copilot', '--model', 'm1']);
  assert.equal(init.code, 0, init.err);
  return dir;
};

test('parseStepArgs takes only --dir (default .), --run-id and --control', () => {
  assert.deepEqual(parseStepArgs([]), { ok: true, dir: '.', runId: 'default' });
  assert.deepEqual(parseStepArgs(['--dir', '/sb', '--run-id', 'x']), { ok: true, dir: '/sb', runId: 'x' });
  assert.deepEqual(parseStepArgs(['--control', 'c.json'], { control: true }), { ok: true, dir: '.', runId: 'default', control: 'c.json' });
  for (const flag of ['--config', '--repo', '--objective']) assert.equal(parseStepArgs([flag, 'x']).ok, false, flag);
});

test('interview takes no --objective, --config or --repo', async () => {
  for (const flag of ['--objective', '--config', '--repo']) {
    const r = await run(['hodge', flag, 'x']);
    assert.equal(r.code, 2, flag);
    assert.match(r.err, new RegExp(`unknown argument '${flag}'`));
  }
});

test('commands run from inside the sandbox (--dir defaults to cwd)', async () => {
  const dir = await sandbox();
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const r = await run(['status']);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).iterations, 0);
    const lint = await run(['spec-lint']);
    assert.equal(lint.code, 0, lint.out + lint.err);
  } finally {
    process.chdir(prev);
  }
});

test('init records where hodgepodge lives in the sandbox config', async () => {
  const dir = await sandbox();
  const cfg = JSON.parse(readFileSync(join(dir, 'hodge.json'), 'utf8'));
  assert.equal(cfg.hodgepodge, '.hodgepodge');
});

test('status needs only --dir', async () => {
  const dir = await sandbox();
  const r = await run(['status', '--dir', dir]);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).iterations, 0);
});

test('relative --dir is resolved', async () => {
  const dir = await sandbox();
  const r = await run(['status', '--dir', dir.replace(/\/sb$/, '/./sb')]);
  assert.equal(r.code, 0, r.err);
});

test('spec-lint takes --dir and lints <dir>/target', async () => {
  const dir = await sandbox();
  const r = await run(['spec-lint', '--dir', dir]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(JSON.parse(r.out).ok, true);
});

test('--dir without a sandbox reports the missing config', async () => {
  const r = await run(['status', '--dir', join(mkdtempSync(join(tmpdir(), 'cli-dir-')), 'none')]);
  assert.equal(r.code, 2);
  assert.match(r.err, /hodge\.json/);
});

test('sync and promote accept --dir (repo = <dir>/target)', async () => {
  const dir = await sandbox();
  /** @type {string[][]} */
  const calls = [];
  const code = await main(['promote', '--dir', dir, '--run-id', 'r1', '--head', 'h', '--base', 'main', '--bucket', 'b', '--sha', 'abc'], {
    exec: async (cmd, args) => {
      calls.push([cmd, ...args]);
      return { code: 0, stdout: 'https://example/pr/1\n', stderr: '' };
    },
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(code, 0);
  assert.ok(calls.length > 0);
});

test('help documents --dir', () => {
  assert.match(helpText(), /--dir <sandbox>/);
});
