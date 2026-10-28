import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { commitProjectConfig, withCwd } from './support/project.js';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '..', 'bin', 'hodgepodge');
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const AWS = 'AKIAIOSFODNN7EXAMPLE';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

/**
 * @param {string[]} argv
 */
async function hodge(argv, registry) {
  /** @type {string[]} */
  const outs = [];
  const code = await main(argv, {
    ...(registry ? { registry } : {}),
    identity: { root: '/nonexistent/hodgepodge', remotes: [] },
    stdout: (s) => outs.push(s),
    stderr: () => {},
  });
  return { code, res: JSON.parse(outs.join('')) };
}

test('phase 3 exit: pause, steer and stop via hodgepodge control drive podge', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-p3-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'toy', type: 'module', scripts: { test: 'node -e 0' } }));
  writeFileSync(join(dir, 'plan.md'), '- [ ] a\n- [ ] b\n- [ ] c\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'target');

  const tmp = mkdtempSync(join(tmpdir(), 'hodge-cfg-'));
  const ctl = join(tmp, 'control.json');
  const config = {
    roles: { build: { adapter: 'scripted', model: 'm' } },
    budgets: { maxWallClockSeconds: 60, maxIterations: 5 },
    allowedPaths: ['src/'],
  };

  /** @type {string[]} */
  const prompts = [];
  const adapter = {
    async run(req) {
      prompts.push(req.prompt);
      const n = prompts.length;
      writeFileSync(join(req.cwd, 'plan.md'), '- [x] a\n- [ ] b\n- [ ] c\n');
      mkdirSync(join(req.cwd, 'src'), { recursive: true });
      writeFileSync(join(req.cwd, 'src', `f${n}.txt`), `${n}\n`);
      // the operator stops the run while iteration 2 is in flight
      if (n === 2) await hodge(['control', '--file', ctl, 'stop']);
      return { exitStatus: 0, transcript: `iter ${n}`, changedFiles: [`src/f${n}.txt`, 'plan.md'] };
    },
  };

  // pause first, then steer: the run must not start an iteration while paused
  assert.equal((await hodge(['control', '--file', ctl, 'pause'])).res.ok, true);
  assert.equal((await hodge(['control', '--file', ctl, 'steer', 'prefer small functions'])).res.ok, true);
  commitProjectConfig(dir, config);
  const running = withCwd(dir, () => hodge(['podge', '--run-id', 'p3', '--control', ctl], { scripted: () => adapter }));
  await sleep(300);
  assert.equal(prompts.length, 0, 'no iteration while paused');
  assert.equal(existsSync(join(dir, 'runs', 'p3')), false);

  assert.equal((await hodge(['control', '--file', ctl, 'resume'])).res.ok, true);
  const run = await running;

  assert.equal(run.res.status, 'stopped', JSON.stringify(run.res));
  assert.equal(run.code, 1);
  assert.equal(run.res.steps.length, 2);
  assert.match(prompts[0], /prefer small functions/);
  assert.doesNotMatch(prompts[1], /prefer small functions/, 'steer is used for one iteration only');
  assert.equal(JSON.parse(readFileSync(ctl, 'utf8')).steer, undefined);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('phase 3 exit: hodgepodge proxy (subprocess) redacts secrets, audits without values, and meters usage', async () => {
  /** @type {string[]} */
  const seen = [];
  const upstream = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen.push(b);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } }));
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', () => r(undefined)));
  const up = /** @type {import('node:net').AddressInfo} */ (upstream.address());

  const tmp = mkdtempSync(join(tmpdir(), 'hodge-proxy-'));
  const audit = join(tmp, 'audit.jsonl');
  const meter = join(tmp, 'meter.jsonl');
  const child = spawn(process.execPath, [bin, 'proxy', '--upstream', `http://127.0.0.1:${up.port}`, '--audit', audit, '--meter', meter], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const port = await new Promise((resolve, reject) => {
      let buf = '';
      child.on('error', reject);
      child.on('exit', (c) => reject(new Error(`proxy exited early (${c})`)));
      child.stdout.on('data', (d) => {
        buf += d;
        try {
          resolve(JSON.parse(buf).port);
        } catch {}
      });
    });

    const r = await fetch(`http://127.0.0.1:${port}/v1/chat`, { method: 'POST', body: JSON.stringify({ prompt: `key ${AWS}` }) });
    assert.equal(r.status, 200);
    assert.equal(seen.length, 1);
    assert.doesNotMatch(seen[0], new RegExp(AWS));
    assert.match(seen[0], /\[REDACTED:[\w-]+\]/);

    const auditText = readFileSync(audit, 'utf8');
    assert.ok(auditText.trim().length > 0);
    assert.doesNotMatch(auditText, new RegExp(AWS));
    const m = JSON.parse(readFileSync(meter, 'utf8').trim().split('\n')[0]);
    assert.equal(m.tokens, 42);
  } finally {
    const exited = new Promise((r) => child.once('exit', (code) => r(code)));
    child.kill('SIGTERM');
    assert.equal(await exited, 0);
    upstream.close();
  }
});
