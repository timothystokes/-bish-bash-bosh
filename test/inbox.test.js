import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { addEntry, readInbox, consumeInbox, inboxSection, INBOX_FILE } from '../src/inbox.js';
import { main } from '../src/cli.js';
import { buildInterviewPrompt, runInterview } from '../src/hodge-interview.js';
import { writeProjectConfig, withCwd } from './support/project.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'hodge-inbox-'));

test('O-3: entries go to more-questions.md (hodge) and more-todos.md (podge) in the project, one bullet each', () => {
  const dir = tmp();
  assert.deepEqual(INBOX_FILE, { hodge: 'more-questions.md', podge: 'more-todos.md' });
  addEntry(dir, 'hodge', 'What about SSO?');
  addEntry(dir, 'hodge', '  second\nline  ');
  addEntry(dir, 'podge', 'add a retry test');
  assert.equal(readFileSync(join(dir, 'more-questions.md'), 'utf8'), '- What about SSO?\n- second line\n');
  assert.equal(readFileSync(join(dir, 'more-todos.md'), 'utf8'), '- add a retry test\n');
  assert.equal(readInbox(dir, 'hodge'), '- What about SSO?\n- second line\n');
  assert.equal(readInbox(tmp(), 'podge'), '');
});

test('O-3: a blank entry is refused and writes nothing', () => {
  const dir = tmp();
  assert.throws(() => addEntry(dir, 'podge', '   '), /empty/);
  assert.equal(existsSync(join(dir, 'more-todos.md')), false);
});

test('O-3: consumeInbox removes what was used but keeps entries added meanwhile', () => {
  const dir = tmp();
  addEntry(dir, 'podge', 'a');
  const used = readInbox(dir, 'podge');
  addEntry(dir, 'podge', 'b');
  consumeInbox(dir, 'podge', used);
  assert.equal(readInbox(dir, 'podge'), '- b\n');
  consumeInbox(dir, 'podge', readInbox(dir, 'podge'));
  assert.equal(existsSync(join(dir, 'more-todos.md')), false);
});

test('O-3: inboxSection names the checklist action per kind and is empty without entries', () => {
  assert.deepEqual(inboxSection('hodge', ''), []);
  const h = inboxSection('hodge', '- q1\n').join('\n');
  assert.match(h, /## More questions/);
  assert.match(h, /Assess/);
  assert.match(h, /- q1/);
  const p = inboxSection('podge', '- t1\n').join('\n');
  assert.match(p, /## More todos/);
  assert.match(p, /plan\.md/);
  assert.match(p, /before/);
});

test('O-3: prompts carry the entries only when given', () => {
  const repo = tmp();
  mkdirSync(join(repo, 'specs'));
  writeFileSync(join(repo, 'plan.md'), '- [ ] item\n');
  assert.doesNotMatch(buildInterviewPrompt(repo, 'obj'), /More questions/);
  assert.match(buildInterviewPrompt(repo, 'obj', false, '- q1\n'), /## More questions[\s\S]*- q1/);
});

test('O-3: `hodgepodge console <kind>` writes each stdin line and stops at /quit; no model, no lock', async () => {
  const dir = tmp();
  writeProjectConfig(dir, { adapter: 'fake', model: 'm' });
  const out = /** @type {string[]} */ ([]);
  const code = await withCwd(dir, () =>
    main(['console', 'hodge'], {
      input: Readable.from(['one\n\ntwo\n/quit\nignored\n']),
      stdout: (s) => { out.push(s); },
    }));
  assert.equal(code, 0);
  assert.equal(readFileSync(join(dir, 'more-questions.md'), 'utf8'), '- one\n- two\n');
  assert.equal(existsSync(join(dir, '.hodge.lock')), false);
  assert.equal(out.filter((l) => /queued/.test(l)).length, 2);
});

test('O-3: console rejects an unknown kind', async () => {
  const err = /** @type {string[]} */ ([]);
  const code = await main(['console', 'bogus'], { input: Readable.from([]), stdout: () => {}, stderr: (s) => { err.push(s); } });
  assert.equal(code, 2);
  assert.match(err.join(''), /hodge or podge/);
});

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

function makeRepo() {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  mkdirSync(join(dir, 'specs'));
  writeFileSync(join(dir, 'specs', 'a.md'), '# Spec: a\n');
  writeFileSync(join(dir, 'plan.md'), '- [ ] item\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const cfg = {
  adapter: 'fake',
  model: 'm',
};

test('O-3: runInterview sends the project questions and consumes them unless the round failed', async () => {
  const repo = makeRepo();
  const inboxDir = tmp();
  addEntry(inboxDir, 'hodge', 'what about offline mode?');
  /** @type {string[]} */
  const prompts = [];
  const adapter = {
    run: async (/** @type {{prompt: string}} */ req) => {
      prompts.push(req.prompt);
      return { exitStatus: 1, transcript: '', changedFiles: [] };
    },
  };
  const res = await runInterview({ config: cfg, repoDir: repo, runId: 'r', adapter: /** @type {any} */ (adapter), objective: 'obj', inboxDir });
  assert.equal(res.status, 'failed');
  assert.match(prompts[0], /## More questions[\s\S]*offline mode/);
  assert.match(readInbox(inboxDir, 'hodge'), /offline mode/);

  const ok = {
    run: async () => {
      writeFileSync(join(repo, 'specs', 'b.md'), '# Spec: b\n');
      return { exitStatus: 0, transcript: '', changedFiles: [] };
    },
  };
  await runInterview({ config: cfg, repoDir: repo, runId: 'r', adapter: /** @type {any} */ (ok), objective: 'obj', round: 2, inboxDir });
  assert.equal(readInbox(inboxDir, 'hodge'), '');
});
