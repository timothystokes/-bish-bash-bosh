import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../../src/cli/cli.js';
import { freshDir, initGitRepo, commitProjectConfig, withCwd } from '../support/project.js';

const config = (overrides = {}) => ({ adapter: 'f', model: 'm', ...overrides });

function fakeAdapter(planPath) {
  const calls = [];
  return {
    calls,
    run: async (req) => {
      calls.push(req);
      if (planPath) writeFileSync(planPath, '# Plan\n\n1. [ ] T: Create index.html - the page S: 1\n2. [x] T: Done thing\n');
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
  const adapter = fakeAdapter(join(dir, '.bish-bash-bosh', 'plan.md'));
  const registry = { pl: () => adapter };
  const out = [];
  const code = await withCwd(dir, () =>
    main(['bash'], { registry, stdout: (s) => { out.push(s); }, stderr: () => {} }));
  assert.equal(code, 0);
  const text = out.join('');
  assert.match(text, /Wrote \.bish-bash-bosh\/plan\.md from its template\./);
  assert.ok(existsSync(join(dir, '.bish-bash-bosh', 'plan.md')), 'plan.md seeded from the template');
  assert.equal(adapter.calls.length, 1, 'one planning call in this same run, no second invocation needed');
  assert.ok(!('session' in adapter.calls[0]), 'planning runs in a fresh context');
  assert.match(text, /Plan ready: 2 items in \.bish-bash-bosh\/plan\.md, 1 left to build/);
  const last = execFileSync('git', ['-C', dir, 'log', '-1', '--format=%B'], { encoding: 'utf8' });
  assert.match(last, /^bash: write plan \(2 tasks, 1 to build\)\n\nFirst: Create index\.html/);
  assert.equal(execFileSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(), '2', 'one commit for the whole plan');
});
