import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { freshDir, initGitRepo, commitProjectConfig, withCwd } from './support/project.js';

const config = (overrides = {}) => ({ adapter: 'f', model: 'm', ...overrides });

function fakeAdapter() {
  const calls = [];
  return {
    calls,
    run: async (req) => {
      calls.push(req);
      return { exitStatus: 0, transcript: '', changedFiles: [], session: req.session };
    },
  };
}

test('podge requires plan.md (written by `gepo`) to exist first', async () => {
  const dir = initGitRepo(freshDir('podge-cli-'));
  commitProjectConfig(dir, config());
  const err = [];
  const code = await withCwd(dir, () => main(['podge'], { stdout: () => {}, stderr: (s) => err.push(s) }));
  assert.equal(code, 2);
  assert.match(err.join(''), /\.hodgepodge\/plan\.md not found\. Run `gepo` first\./);
});

test('podge drives the Build Loop over every unprocessed plan.md item, ticking each as it is handed to the agent', async () => {
  const dir = initGitRepo(freshDir('podge-cli-'));
  commitProjectConfig(dir, config({ adapter: 'bl' }));
  writeFileSync(
    join(dir, '.hodgepodge', 'plan.md'),
    '# Plan\n\n- [ ] Phase: Core. Task: Implement the login screen.\n',
  );
  const adapter = fakeAdapter();
  const registry = { bl: () => adapter };
  const out = [];
  const code = await withCwd(dir, () =>
    main(['podge'], { registry, stdout: (s) => { out.push(s); }, stderr: () => {} }));
  assert.equal(code, 0);
  assert.equal(adapter.calls.length, 1);
  assert.match(out.join(''), /Build complete: 1 item processed this run\./);
  assert.ok(existsSync(join(dir, '.hodgepodge', 'podge-log.md')), 'podge-log.md is created');
  const planAfter = readFileSync(join(dir, '.hodgepodge', 'plan.md'), 'utf8');
  assert.match(planAfter, /- \[x\] Phase: Core\. Task: Implement the login screen\./, 'the item is marked processed');
});
