import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { acquireRunLock, LOCK_FILE } from '../src/run-lock.js';
import { main } from '../src/cli.js';
import { commitProjectConfig, initGitRepo, withCwd } from './support/project.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'run-lock-'));

test('acquire writes the PID, a second acquire is refused naming the holder, release frees it', () => {
  const dir = tmp();
  const a = acquireRunLock(dir);
  assert.equal(a.ok, true);
  assert.equal(readFileSync(join(dir, LOCK_FILE), 'utf8').trim(), String(process.pid));
  const b = acquireRunLock(dir);
  assert.equal(b.ok, false);
  assert.match(/** @type {any} */ (b).error, new RegExp(`pid ${process.pid}`));
  if (a.ok) a.release();
  assert.equal(existsSync(join(dir, LOCK_FILE)), false);
  const c = acquireRunLock(dir);
  assert.equal(c.ok, true);
});

test('a stale lock (dead PID) or garbage lock is cleared', () => {
  const dir = tmp();
  mkdirSync(dirname(join(dir, LOCK_FILE)), { recursive: true });
  writeFileSync(join(dir, LOCK_FILE), '2147483646\n');
  assert.equal(acquireRunLock(dir).ok, true);
  const dir2 = tmp();
  mkdirSync(dirname(join(dir2, LOCK_FILE)), { recursive: true });
  writeFileSync(join(dir2, LOCK_FILE), 'junk');
  assert.equal(acquireRunLock(dir2).ok, true);
});

test('release does not remove a lock now owned by another PID', () => {
  const dir = tmp();
  const a = acquireRunLock(dir);
  writeFileSync(join(dir, LOCK_FILE), `${process.ppid}\n`);
  if (a.ok) a.release();
  assert.equal(existsSync(join(dir, LOCK_FILE)), true);
});

/** @param {string[]} args */
async function run(args) {
  /** @type {string[]} */
  const errs = [];
  const code = await main(args, { stdout: () => {}, stderr: (s) => errs.push(s) });
  return { code, err: errs.join('') };
}

test('hodge, podge and podge step refuse a project held by a live process, and release the lock when done', async () => {
  const dir = tmp();
  initGitRepo(dir);
  await withCwd(dir, async () => {
    commitProjectConfig(dir, { roles: { build: { adapter: 'f', model: 'm' } }, allowedPaths: ['src/'] });
    writeFileSync(join(dir, LOCK_FILE), `${process.ppid}\n`);
    for (const args of [['hodge'], ['hodge', '--reverse'], ['podge'], ['podge', 'step']]) {
      const r = await run(args);
      assert.equal(r.code, 2, args.join(' '));
      assert.match(r.err, /another run holds this project/);
    }
    mkdirSync(dirname(join(dir, LOCK_FILE)), { recursive: true });
    writeFileSync(join(dir, LOCK_FILE), '2147483646\n');
    const r = await main(['podge', 'step'], { stdout: () => {}, stderr: () => {}, registry: {} });
    assert.notEqual(r, undefined);
    assert.equal(existsSync(join(dir, LOCK_FILE)), false);
  });
});
