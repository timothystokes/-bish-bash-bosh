import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadModePrompt } from '../src/prompts.js';
import { buildPrompt, runStep } from '../src/step.js';
import { validateConfig } from '../src/config.js';
import { createFakeAdapter } from '../src/adapter.js';

const baseConfig = () => ({
  targetRepo: 'git@example.com:o/target.git',
  roles: { build: { adapter: 'a', model: 'm' } },
  budgets: { maxTokens: 1000, maxCostUsd: 5, maxWallClockSeconds: 60, maxIterations: 5 },
  allowedPaths: ['src/**'],
});

test('forward prompt carries the loop rules', () => {
  const p = loadModePrompt('forward');
  assert.match(p, /search before assuming/i);
  assert.match(p, /tests come first/i);
  assert.match(p, /plan\.md/);
});

test('unknown or unwritten modes are rejected', () => {
  assert.throws(() => loadModePrompt('nonsense'), /unknown mode/i);
  assert.throws(() => loadModePrompt('../forward'), /unknown mode/i);
});

test('buildPrompt defaults to forward and uses the selected mode prompt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-prompt-'));
  assert.ok(buildPrompt(dir).startsWith(loadModePrompt('forward')));
  assert.ok(buildPrompt(dir, 'forward').startsWith(loadModePrompt('forward')));
  assert.throws(() => buildPrompt(dir, 'nonsense'), /unknown mode/i);
});

test('config accepts a known mode and rejects others', () => {
  assert.equal(validateConfig({ ...baseConfig(), mode: 'forward' }).ok, true);
  assert.equal(validateConfig({ ...baseConfig(), mode: 'nonsense' }).ok, false);
  assert.equal(validateConfig({ ...baseConfig(), mode: 3 }).ok, false);
});

test('runStep sends the configured mode prompt to the adapter', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-prompt-'));
  const git = (/** @type {string[]} */ ...a) => execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...a]);
  git('init', '-q');
  git('config', 'user.email', 't@e.st');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, 'specs'));
  writeFileSync(join(dir, 'specs', 'a.md'), '# Spec: A\n');
  writeFileSync(join(dir, 'plan.md'), '- [ ] x\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  /** @type {string[]} */
  const seen = [];
  const inner = createFakeAdapter({ exitStatus: 0, transcript: 't', writes: { 'src/x.js': 'x' }, usage: { tokens: 1, cost: 0 } });
  const adapter = { ...inner, run: (/** @type {any} */ req) => { seen.push(req.prompt); return inner.run(req); } };
  await runStep({
    config: { ...baseConfig(), mode: 'forward' }, repoDir: dir, runId: 'r',
    adapter, testCommand: ['node', '-e', ''], identity: { root: '/nonexistent/hodgepodge', remotes: [] },
  });
  assert.ok(seen[0]?.startsWith(loadModePrompt('forward')));
});
