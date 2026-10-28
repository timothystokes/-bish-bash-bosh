import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateFinding, parseFindings, findingsToPlanItems, runQaCycle, qaCycles } from '../src/podge-qa.js';
import { runLoop } from '../src/podge-driver.js';
import { sumRunUsage } from '../src/budget-gate.js';
import { writeIterationRecord } from '../src/podge-run-record.js';
import { validateConfig } from '../src/config.js';
import { loadQaPrompt } from '../src/prompts.js';
import { main } from '../src/cli.js';
import { writeProjectConfig, commitProjectConfig, withCwd } from './support/project.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

const diagnosis = { rootCause: 'rc', evidence: 'ev', fix: 'Handle empty input', test: 'ts', prevention: 'pv' };
const finding = {
  classification: 'unimplemented-requirement',
  severity: 'high',
  spec: 'specs/a.md',
  consequence: 'empty input crashes',
  diagnosis,
};
const block = (/** @type {unknown} */ o) => `report\n\`\`\`findings\n${JSON.stringify(o)}\n\`\`\`\n`;

/** @param {string} plan */
function makeRepo(plan = '- [x] one\n') {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-qa-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  mkdirSync(join(dir, 'specs'));
  writeFileSync(join(dir, 'specs', 'a.md'), '# Spec A\n');
  writeFileSync(join(dir, 'plan.md'), plan);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const config = (extra = {}) => ({
  roles: { build: { adapter: 'b', model: 'm' }, qa: { adapter: 'q', model: 'm2' } },
  budgets: { maxWallClockSeconds: 60, maxIterations: 20 },
  allowedPaths: ['src/'],
  ...extra,
});
const identity = { root: '/nonexistent/hodgepodge', remotes: [] };
const pass = ['node', '-e', 'process.exit(0)'];

/** @param {string} transcript @param {{exitStatus?: number, write?: boolean}} [o] */
const qaAdapter = (transcript, { exitStatus = 0, write = false } = {}) => ({
  async run(/** @type {any} */ req) {
    if (write) writeFileSync(join(req.cwd, 'src.js'), 'x');
    return { exitStatus, transcript, changedFiles: [] };
  },
});

test('validateFinding needs classification, severity, spec, consequence and a full diagnosis', () => {
  assert.deepEqual(validateFinding(finding), { ok: true, errors: [] });
  assert.equal(validateFinding({ ...finding, classification: 'meh' }).ok, false);
  assert.equal(validateFinding({ ...finding, severity: 'huge' }).ok, false);
  assert.equal(validateFinding({ ...finding, spec: '' }).ok, false);
  assert.equal(validateFinding({ ...finding, consequence: undefined }).ok, false);
  assert.equal(validateFinding({ ...finding, diagnosis: { rootCause: 'x' } }).ok, false);
  assert.equal(validateFinding(null).ok, false);
});

test('parseFindings reads the last fenced findings block; absent or invalid is an error, [] is clean', () => {
  assert.deepEqual(parseFindings(block([finding])), { ok: true, findings: [finding] });
  assert.deepEqual(parseFindings(block([finding]) + block([])), { ok: true, findings: [] });
  assert.equal(parseFindings('no block').ok, false);
  assert.equal(parseFindings('```findings\n{bad\n```').ok, false);
  assert.equal(parseFindings(block({ not: 'an array' })).ok, false);
  assert.equal(parseFindings(block([{ ...finding, severity: 'x' }])).ok, false);
});

test('findingsToPlanItems renders one unchecked single-line item per finding under a QA heading', () => {
  const plan = findingsToPlanItems('- [x] one\n', 2, [{ ...finding, diagnosis: { ...diagnosis, fix: 'line1\nline2' } }, finding]);
  assert.match(plan, /^## QA findings$/m);
  assert.match(plan, /^- \[ \] QA-2-1 \[high\] unimplemented-requirement \(specs\/a\.md\): line1 line2 /m);
  assert.match(plan, /^- \[ \] QA-2-2 /m);
  assert.equal(findingsToPlanItems(plan, 3, [finding]).match(/^## QA findings$/gm)?.length, 1, 'heading is not repeated');
});

test('qa prompt frames a skeptical independent evaluator that cannot modify the tree', () => {
  const p = loadQaPrompt();
  assert.match(p, /did not write/i);
  assert.match(p, /skeptic/i);
  for (const c of ['violated-decision', 'unimplemented-requirement', 'decision-needing-replacement']) assert.ok(p.includes(c), c);
  assert.match(p, /fenced `findings` block/);
  assert.match(p, /read-only/i);
});

test('config accepts an optional qa role and maxQaCycles; rejects a non-positive maxQaCycles', () => {
  assert.equal(validateConfig(config({ maxQaCycles: 3 })).ok, true);
  assert.equal(validateConfig(config({ maxQaCycles: 0 })).ok, false);
});

test('runQaCycle: a [] report is clean; findings are handed to plan.md and committed; the record counts toward run seconds', async () => {
  const dir = makeRepo();
  const clean = await runQaCycle({ config: config(), repoDir: dir, runId: 'r', adapter: qaAdapter(block([])), identity });
  assert.equal(clean.status, 'clean');
  assert.equal(clean.cycle, 1);
  assert.equal(qaCycles(dir, 'r'), 1);
  assert.equal(readFileSync(join(dir, 'plan.md'), 'utf8'), '- [x] one\n');

  const found = await runQaCycle({ config: config(), repoDir: dir, runId: 'r', adapter: qaAdapter(block([finding])), identity });
  assert.equal(found.status, 'findings');
  assert.equal(found.cycle, 2);
  assert.equal(found.findings?.length, 1);
  assert.match(readFileSync(join(dir, 'plan.md'), 'utf8'), /- \[ \] QA-2-1 \[high\]/);
  assert.ok(existsSync(join(dir, 'runs', 'r', 'qa-2', 'findings.json')));
  assert.equal(JSON.parse(readFileSync(join(dir, 'runs', 'r', 'qa-2', 'findings.json'), 'utf8'))[0].diagnosis.fix, 'Handle empty input');
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.ok(sumRunUsage(dir, 'r').seconds >= 0);
  assert.equal(JSON.parse(readFileSync(join(dir, 'runs', 'r', 'qa-2', 'record.json'), 'utf8')).usage.seconds >= 0, true);
});

test('runQaCycle fails (no pass by silence) on a missing report, non-zero exit, or a modified tree; tree stays clean', async () => {
  const dir = makeRepo();
  const run = (/** @type {any} */ adapter) => runQaCycle({ config: config(), repoDir: dir, runId: 'r', adapter, identity });
  const none = await run(qaAdapter('looks fine to me'));
  assert.equal(none.status, 'failed');
  assert.match(none.reason ?? '', /findings/);
  const bad = await run(qaAdapter(block([]), { exitStatus: 1 }));
  assert.equal(bad.status, 'failed');
  const wrote = await run(qaAdapter(block([]), { write: true }));
  assert.equal(wrote.status, 'failed');
  assert.match(wrote.reason ?? '', /read-only|modified/);
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(existsSync(join(dir, 'src.js')), false);
  assert.equal(readFileSync(join(dir, 'plan.md'), 'utf8'), '- [x] one\n');
});

test('runQaCycle reports over-budget when wall-clock is exhausted, and gates the harness repo', async () => {
  const dir = makeRepo();
  writeIterationRecord(dir, 'r', 1, { status: 'ok', usage: { seconds: 60 }, changedFiles: [], gates: [], prompt: '', transcript: '', diff: '', test: {} });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'spent');
  const over = await runQaCycle({ config: config(), repoDir: dir, runId: 'r', adapter: qaAdapter(block([])), identity });
  assert.equal(over.status, 'over-budget');
  const self = await runQaCycle({ config: config(), repoDir: dir, runId: 'r2', adapter: qaAdapter(block([])), identity: { root: dir, remotes: [] } });
  assert.equal(self.status, 'gated');
});

/** Build agent that ticks everything it is given: fixes QA items by ticking them. */
const builder = () => ({
  async run(/** @type {any} */ req) {
    const p = join(req.cwd, 'plan.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace(/- \[ \]/g, '- [x]'));
    return { exitStatus: 0, transcript: 't', changedFiles: ['plan.md'] };
  },
});

test('runLoop with a qa adapter: done needs a clean QA report; findings go back to build, then QA re-verifies', async () => {
  const dir = makeRepo('- [x] one\n');
  /** @type {string[]} */
  const reports = [block([finding]), block([])];
  let qaCalls = 0;
  const qa = { async run() { qaCalls += 1; return { exitStatus: 0, transcript: reports.shift() ?? block([]), changedFiles: [] }; } };
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter: builder(), qaAdapter: qa, testCommand: pass, identity });
  assert.equal(res.status, 'done');
  assert.equal(qaCalls, 2);
  assert.equal(res.steps.length, 2, 'one build step, then one to fix the QA item');
  assert.deepEqual(res.qa?.map((q) => q.status), ['findings', 'clean']);
  assert.match(readFileSync(join(dir, 'plan.md'), 'utf8'), /- \[x\] QA-1-1/);
});

test('runLoop without a qa adapter finishes as before', async () => {
  const dir = makeRepo('- [ ] one\n');
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter: builder(), testCommand: pass, identity });
  assert.equal(res.status, 'done');
  assert.equal(res.qa, undefined);
});

test('runLoop stops failed once maxQaCycles QA reports have been spent', async () => {
  const dir = makeRepo('- [x] one\n');
  let qaCalls = 0;
  const qa = { async run() { qaCalls += 1; return { exitStatus: 0, transcript: block([finding]), changedFiles: [] }; } };
  const res = await runLoop({ config: config({ maxQaCycles: 2 }), repoDir: dir, runId: 'r', adapter: builder(), qaAdapter: qa, testCommand: pass, identity });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /qa cycle limit \(2\)/);
  assert.equal(qaCalls, 2);
});

test('runLoop propagates a failed QA run as a failed loop', async () => {
  const dir = makeRepo('- [x] one\n');
  const res = await runLoop({ config: config(), repoDir: dir, runId: 'r', adapter: builder(), qaAdapter: qaAdapter('no report'), testCommand: pass, identity });
  assert.equal(res.status, 'failed');
  assert.match(res.reason ?? '', /qa/i);
});

test('podge uses the configured qa role adapter, distinct from build', async () => {
  const dir = makeRepo('- [x] one\n');
  /** @type {string[]} */
  const used = [];
  const registry = {
    b: () => ({ async run() { used.push('build'); return { exitStatus: 0, transcript: '', changedFiles: [] }; } }),
    q: () => ({ async run() { used.push('qa'); return { exitStatus: 0, transcript: block([]), changedFiles: [] }; } }),
  };
  commitProjectConfig(dir, config());
  let out = '';
  const code = await withCwd(dir, () => main(['podge'], { registry, testCommand: pass, identity, stdout: (s) => { out += s; }, stderr: () => {} }));
  assert.equal(code, 0, out);
  assert.deepEqual(used, ['build', 'qa']);
  assert.equal(JSON.parse(out).status, 'done');
});
