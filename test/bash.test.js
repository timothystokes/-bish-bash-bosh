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

test('bash on a fresh repo seeds plan.md from its template, then falls straight through into the plan loop in the same invocation (no second run needed)', async () => {
  const dir = initGitRepo(freshDir('bash-cli-'));
  commitProjectConfig(dir, config({ adapter: 'pl' }));
  writeFileSync(
    join(dir, '.bish-bash-bosh', 'specification.md'),
    '# Specification\n\n1. [ ] C: Provide a login screen. B: Users can authenticate.\n',
  );
  const adapter = fakeAdapter();
  const registry = { pl: () => adapter };
  const out = [];
  const code = await withCwd(dir, () =>
    main(['bash'], { registry, stdout: (s) => { out.push(s); }, stderr: () => {} }));
  assert.equal(code, 0);
  const text = out.join('');
  assert.match(text, /Wrote \.bish-bash-bosh\/plan\.md from its template\./);
  assert.ok(existsSync(join(dir, '.bish-bash-bosh', 'plan.md')), 'plan.md seeded from the template');
  assert.equal(adapter.calls.length, 1, 'the one specification item was handed to the agent in this same run, no second invocation needed');
  assert.match(text, /Plan complete: 1 item processed this run\./);
  const specAfter = readFileSync(join(dir, '.bish-bash-bosh', 'specification.md'), 'utf8');
  assert.match(specAfter, /1\. \[x\] C: Provide a login screen\./, 'the item is marked processed');
});
