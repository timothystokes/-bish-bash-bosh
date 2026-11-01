import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInterview, buildInterviewPrompt } from '../src/hodge-interview.js';
import { loadModePrompt } from '../src/prompts.js';
import { main } from '../src/cli.js';
import { lintSpecs } from '../src/spec-lint.js';
import { writeProjectConfig, commitProjectConfig, withCwd } from './support/project.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-int-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  writeFileSync(join(dir, 'README.md'), '# target\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const config = (/** @type {{adapter?: string, model?: string}} */ overrides = {}) => ({
  adapter: 'f',
  model: 'm',
  ...overrides,
});

const identity = { root: '/nonexistent/hodgepodge', remotes: [] };

const goodWrites = {
  'specs/greet.md': '# Spec: Greeter\nImplementation: none\n\n## Requirements\n- R-greet-1: must greet\n',
};

/** @param {Record<string, string>} writes @param {number} [exitStatus] */
const agent = (writes, exitStatus = 0) => {
  /** @type {string[]} */
  const prompts = [];
  return {
    prompts,
    adapter: {
      async run(req) {
        prompts.push(req.prompt);
        const { createFakeAdapter } = await import('../src/adapter.js');
        return createFakeAdapter({ exitStatus, transcript: 't', writes }).run(req);
      },
    },
  };
};

test('interview prompt exists, carries the objective and the spec template, not the test-plan template', () => {
  const dir = makeRepo();
  const p = buildInterviewPrompt(dir, 'Build a greeter');
  assert.match(p, /Build a greeter/);
  assert.match(p, /# Spec: <name/);
  assert.doesNotMatch(p, /\| Spec \| Tests \|/);
  assert.doesNotMatch(loadModePrompt('interview'), /write tests\/PLAN\.md/i);
});

test('a single-shot interview (no question left) that is lint-clean is committed with a record', async () => {
  const dir = makeRepo();
  const a = agent(goodWrites);
  const res = await runInterview({ config: config(), repoDir: dir, runId: 'r1', adapter: a.adapter, objective: 'Build a greeter', identity });
  assert.equal(res.status, 'ok');
  assert.equal(res.sha, git(dir, 'rev-parse', 'HEAD'));
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(lintSpecs(dir, { testPlan: false }).ok, true);
  assert.ok(existsSync(join(dir, '.hodgepodge', 'runs', 'r1', 'interview', 'record.json')));
  assert.equal(JSON.parse(readFileSync(join(dir, '.hodgepodge', 'runs', 'r1', 'interview', 'record.json'), 'utf8')).status, 'ok');
  assert.match(a.prompts[0], /Build a greeter/);
});

test('spec-lint problems at the end of the interview keep the work and are reported as gaps', async () => {
  const dir = makeRepo();
  const res = await runInterview({
    config: config(),
    repoDir: dir,
    runId: 'r1',
    adapter: agent({ 'specs/bad.md': 'no title\n' }).adapter,
    objective: 'x',
    identity,
  });
  assert.equal(res.status, 'incomplete');
  assert.match(res.reason ?? '', /must start with a "# Spec: <name>" title/);
  assert.equal(existsSync(join(dir, 'specs', 'bad.md')), true);
  assert.equal(JSON.parse(readFileSync(join(dir, '.hodgepodge', 'runs', 'r1', 'interview', 'record.json'), 'utf8')).status, 'incomplete');
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('the test-plan mapping is not an interview check: specs without tests/PLAN.md are lint-clean for the interview', async () => {
  const dir = makeRepo();
  const res = await runInterview({ config: config(), repoDir: dir, runId: 'r1', adapter: agent(goodWrites).adapter, objective: 'x', identity });
  assert.equal(res.status, 'ok');
  assert.equal(existsSync(join(dir, 'tests')), false);
  assert.equal(lintSpecs(dir).ok, false, 'the full lint (plan stage) still needs the mapping');
  assert.equal(lintSpecs(dir, { testPlan: false }).ok, true);
});

test('refuses when the agent writes outside specs/ and .hodgepodge/ (tests are the plan stage)', async () => {
  const dir = makeRepo();
  const res = await runInterview({
    config: config(),
    repoDir: dir,
    runId: 'r1',
    adapter: agent({ ...goodWrites, 'src/app.js': 'x\n', 'tests/a.test.js': 'x\n' }).adapter,
    objective: 'x',
    identity,
  });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /src\/app\.js.*tests\/a\.test\.js|tests\/a\.test\.js.*src\/app\.js/);
  assert.equal(existsSync(join(dir, 'src')), false);
});

test('agent failure is failed and discarded', async () => {
  const dir = makeRepo();
  const res = await runInterview({ config: config(), repoDir: dir, runId: 'r1', adapter: agent(goodWrites, 1).adapter, objective: 'x', identity });
  assert.equal(res.status, 'failed');
  assert.equal(existsSync(join(dir, 'specs')), false);
});

test('an agent that exits 0 but changes nothing is failed, not ok', async () => {
  const dir = makeRepo();
  const res = await runInterview({ config: config(), repoDir: dir, runId: 'r1', adapter: agent({}).adapter, objective: 'x', identity });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /no changes/);
});

test('gates: empty objective, dirty tree, harness repo, missing role make no agent call', async () => {
  const dir = makeRepo();
  const a = agent(goodWrites);
  const base = { config: config(), repoDir: dir, runId: 'r1', adapter: a.adapter, identity };
  assert.equal((await runInterview({ ...base, objective: '  ' })).status, 'gated');
  writeFileSync(join(dir, 'dirty.txt'), 'x');
  assert.match((await runInterview({ ...base, objective: 'x' })).reason ?? '', /not clean/);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'clean');
  const self = await runInterview({ ...base, objective: 'x', identity: { root: dir, remotes: [] } });
  assert.equal(self.status, 'gated');
  assert.equal(a.prompts.length, 0);
});

test('hodge on a fresh repo first seeds the interview store from its template; once committed, the Interview Loop asks each unanswered question, hands each round to the agent, and ticks both checkboxes until it pauses or completes', async () => {
  const dir = makeRepo();
  commitProjectConfig(dir, config({ adapter: 'iv' }));
  const a = agent({});
  const registry = { iv: () => a.adapter };
  const out = /** @type {string[]} */ ([]);
  // the very first run only seeds the store from the template: no agent call, no run folder
  const seedCode = await withCwd(dir, () =>
    main(['hodge'], { registry: {}, identity, stdout: (s) => { out.push(s); }, stderr: () => {} }));
  assert.equal(seedCode, 0);
  assert.ok(existsSync(join(dir, '.hodgepodge', 'interview.md')), 'store seeded from the template');
  assert.equal(
    readFileSync(join(dir, '.hodgepodge', 'interview.md'), 'utf8'),
    readFileSync(join(process.cwd(), 'templates', 'interview-template.md'), 'utf8'),
  );
  assert.match(out.join(''), /Wrote \.hodgepodge\/interview\.md and \.hodgepodge\/specification\.md from their templates/);
  assert.ok(existsSync(join(dir, '.hodgepodge', 'specification.md')), 'spec seeded from the template');
  assert.equal(
    readFileSync(join(dir, '.hodgepodge', 'specification.md'), 'utf8'),
    readFileSync(join(process.cwd(), 'templates', 'specification-template.md'), 'utf8'),
  );
  assert.equal(readFileSync(join(dir, '.hodgepodge', 'hodge-log.md'), 'utf8'), '', 'hodge-log.md is created empty on the very first run, before any prompt is ever sent');
  assert.ok(!existsSync(join(dir, '.hodgepodge', 'runs')), 'no run folder on the seed-only run');
  // a second, custom question with a pre-filled default so the loop's resume/default behaviour can be exercised
  writeFileSync(
    join(dir, '.hodgepodge', 'interview.md'),
    `${readFileSync(join(dir, '.hodgepodge', 'interview.md'), 'utf8')}\n2. [ ] Q: Who uses the greeter? A: Developers\n`,
  );
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'seed interview store');
  out.length = 0;
  const paused = await withCwd(dir, () =>
    main(['hodge'], { registry, identity, input: Readable.from(['Build a greeter\n']), stdout: (s) => { out.push(s); }, stderr: () => {} }));
  assert.equal(paused, 1, 'paused at EOF, not ok');
  assert.match(out.join(''), /What is the objective\?/);
  assert.match(out.join(''), /Paused after 1 question: 1 question left\. Run `hodge` again to continue\./);
  assert.equal(a.prompts.length, 1, 'one agent round for the one question answered before EOF');
  assert.match(a.prompts[0], /## Question\n\nWhat is the objective\?\n\n## Answer\n\nBuild a greeter/);
  const afterFirst = readFileSync(join(dir, '.hodgepodge', 'interview.md'), 'utf8');
  assert.match(afterFirst, /1\. \[x\] Q: What is the objective\? A: Build a greeter/, 'checked, and the answer is written back, once handed to and processed by the agent');
  assert.match(afterFirst, /2\. \[ \] Q: Who uses the greeter\? A: Developers/, 'the second question is untouched, not yet asked');
  const logAfterFirst = readFileSync(join(dir, '.hodgepodge', 'hodge-log.md'), 'utf8');
  assert.match(logAfterFirst, /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] hodge: .*## Answer\n\nBuild a greeter/s, 'the full prompt sent to the agent is logged, plain text with a timestamp');
  out.length = 0;
  const done = await withCwd(dir, () =>
    main(['hodge'], { registry, identity, input: Readable.from(['\n']), stdout: (s) => { out.push(s); }, stderr: () => {} }));
  assert.equal(done, 0);
  assert.match(out.join(''), /Who uses the greeter\?/);
  assert.match(out.join(''), /Interview complete: 1 question answered this run\./);
  assert.equal(a.prompts.length, 2, 'the second run handed its round to the agent too');
  const afterSecond = readFileSync(join(dir, '.hodgepodge', 'interview.md'), 'utf8');
  assert.match(afterSecond, /2\. \[x\] Q: Who uses the greeter\? A: Developers/, 'Enter alone accepted the pre-filled default, and the line is checked once handed to and processed by the agent');
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), '# target\n');
});

test('the agent session is persisted in .hodgepodge/config.yml, not a separate file, and carries across hodge invocations', async () => {
  const dir = makeRepo();
  commitProjectConfig(dir, config({ adapter: 'sess' }));
  writeFileSync(
    join(dir, '.hodgepodge', 'interview.md'),
    `${readFileSync(join(process.cwd(), 'templates', 'interview-template.md'), 'utf8')}\n2. [ ] Q: Who uses the greeter? A: Developers\n`,
  );
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'seed interview store');
  /** @type {object[]} */
  const seen = [];
  const sessioned = {
    run: async (/** @type {any} */ req) => {
      seen.push(req.session);
      return { exitStatus: 0, transcript: '', changedFiles: [], session: `s${seen.length}` };
    },
  };
  const registry = { sess: () => sessioned };
  await withCwd(dir, () => main(['hodge'], { registry, identity, input: Readable.from(['Build a greeter\n']), stdout: () => {}, stderr: () => {} }));
  assert.equal(seen[0], undefined, 'no session yet on the very first round');
  let cfg = readFileSync(join(dir, '.hodgepodge', 'config.yml'), 'utf8');
  assert.match(cfg, /hodgeSession: s1/);
  assert.ok(!existsSync(join(dir, '.hodgepodge', 'interview-session.json')), 'no separate session file is written');
  await withCwd(dir, () => main(['hodge'], { registry, identity, input: Readable.from(['\n']), stdout: () => {}, stderr: () => {} }));
  assert.equal(seen[1], 's1', 'the second round resumes the session the first round returned');
  cfg = readFileSync(join(dir, '.hodgepodge', 'config.yml'), 'utf8');
  assert.match(cfg, /hodgeSession: s2/);
});

test('hodge usage errors exit 2', async () => {
  const err = /** @type {string[]} */ ([]);
  const e = (/** @type {string} */ s) => { err.push(s); };
  const missing = mkdtempSync(join(tmpdir(), 'hodge-int-missing-'));
  assert.equal(await withCwd(missing, () => main(['hodge'], { stdout: () => {}, stderr: e })), 2);
  assert.match(err.join(''), /config\.yml/);

  const norole = mkdtempSync(join(tmpdir(), 'hodge-int-norole-'));
  writeProjectConfig(norole, config({ adapter: 'missing' }));
  mkdirSync(join(norole, '.hodgepodge'), { recursive: true });
  writeFileSync(join(norole, '.hodgepodge', 'interview.md'), '# Interview\n');
  err.length = 0;
  // the Interview Loop itself never resolves an adapter; only --reverse still does
  assert.equal(await withCwd(norole, () => main(['hodge', '--reverse'], { registry: { f: () => agent({}).adapter }, stdout: () => {}, stderr: e })), 2);
  assert.match(err.join(''), /unknown adapter 'missing'/);

  err.length = 0;
  assert.equal(await withCwd(norole, () => main(['podge', 'step', '--objective', 'x'], { stdout: () => {}, stderr: e })), 2);
});

test('readlineOptions: a TTY input gets terminal mode so Enter submits; piped input stays plain', async () => {
  const { readlineOptions } = await import('../src/cli.js');
  const tty = Object.assign(new Readable({ read() {} }), { isTTY: true });
  assert.equal(readlineOptions(tty).terminal, true);
  assert.ok(readlineOptions(tty).output);
  assert.equal(readlineOptions(Readable.from([])).terminal, undefined);
});

test("createAsker: on a real terminal, a question's existing default is shown as a grey suggestion ahead of the cursor; any key but Enter clears all of it in one go, and typing afterward inherits the prompt's own color", async () => {
  const { createAsker } = await import('../src/cli-lib.js');
  /** @type {string[]} */
  let chunks;
  const freshOutput = () => Object.assign(new Writable({ write(chunk, _enc, cb) { chunks.push(String(chunk)); cb(); } }), { isTTY: true, columns: 80 });

  // Enter alone, default untouched: submits the default verbatim, rendered in grey ahead of the cursor,
  // then recolored to the prompt's own color as it is accepted (so it no longer reads as a suggestion).
  {
    chunks = [];
    const input = Object.assign(new Readable({ read() {} }), { isTTY: true });
    const { ask } = createAsker(input, () => {}, freshOutput());
    const reply = ask('\x1b[33mA: ', 'Developers');
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(chunks.some((c) => c.includes('\x1b[90mDevelopers')), 'the default is shown in grey');
    assert.ok(chunks.some((c) => c.includes('\x1b[10D')), 'the cursor is moved back before the grey suggestion, not left after it');
    chunks = [];
    input.push('\r');
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(chunks.includes('\x1b[33mDevelopers'), 'accepting via Enter recolors the suggestion to the prompt\'s own color, not left grey');
    assert.equal(await reply, 'Developers');
  }

  // A single Backspace clears the whole default at once (not character by character), and the "A: "
  // label's own color is what the (now empty) line is left in, ready for a fresh answer.
  {
    chunks = [];
    const input = Object.assign(new Readable({ read() {} }), { isTTY: true });
    const { ask } = createAsker(input, () => {}, freshOutput());
    const reply = ask('\x1b[33mA: ', 'Developers');
    await new Promise((r) => setTimeout(r, 20));
    chunks = [];
    input.push('\x7f');
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(chunks, ['\x1b[0K'], 'one Backspace erases the entire suggestion in a single write, not one character at a time');
    input.push('\r');
    assert.equal(await reply, '', 'the default is fully gone, not merely hidden');
  }

  // Clearing the default and typing something else submits the new text, not the old default.
  {
    chunks = [];
    const input = Object.assign(new Readable({ read() {} }), { isTTY: true });
    const { ask } = createAsker(input, () => {}, freshOutput());
    const reply = ask('\x1b[33mA: ', 'Developers');
    await new Promise((r) => setTimeout(r, 20));
    input.push('\x7f');
    input.push('Admins');
    input.push('\r');
    assert.equal(await reply, 'Admins');
  }

  // A key other than Delete/Backspace (e.g. typing straight over the suggestion) clears it the same way.
  {
    chunks = [];
    const input = Object.assign(new Readable({ read() {} }), { isTTY: true });
    const { ask } = createAsker(input, () => {}, freshOutput());
    const reply = ask('\x1b[33mA: ', 'Developers');
    await new Promise((r) => setTimeout(r, 20));
    chunks = [];
    input.push('Q');
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(chunks.includes('\x1b[0K'), 'the first keypress, even a plain character, clears the suggestion before it is typed over');
    input.push('\r');
    assert.equal(await reply, 'Q');
  }
});

