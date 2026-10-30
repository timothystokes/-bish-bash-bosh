import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRunDetails } from '../src/run-details.js';
import { createLocalStatusSource, readRunStatus } from '../src/status.js';
import { renderFrame } from '../src/tui.js';
import { writeDoneReport } from '../src/podge-done.js';
import { main } from '../src/cli.js';
import { writeProjectConfig, withCwd } from './support/project.js';

const budgets = { maxWallClockSeconds: 100, maxIterations: 5 };
const control = /** @type {const} */ ({ ok: true, paused: false, stop: false });

const diagnosis = { rootCause: 'rc', evidence: 'ev', fix: 'fx', test: 't', prevention: 'pv' };
const finding = { classification: 'violated-decision', severity: 'high', spec: 'specs/a.md', consequence: 'bad', diagnosis };

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-details-'));
  mkdirSync(join(dir, 'specs'));
  writeFileSync(
    join(dir, 'specs', 'a.md'),
    [
      '# A',
      '## Requirements',
      '- R-a-1: it must work',
      '## Dimensions',
      '- Actors and goals: covered',
      '- Behaviour: n/a: none',
      '- Edge cases: covered please',
      '## Formats',
      '- openapi: api/openapi.yaml',
      '- json-schema: schemas/x.json -> out/x.json',
      '',
    ].join('\n'),
  );
  writeFileSync(join(dir, 'specs', 'b.md'), '# B\n## Requirements\n- R-b-1: it must work\n');
  mkdirSync(join(dir, '.hodgepodge', 'runs', 'r1', 'qa-1'), { recursive: true });
  writeFileSync(join(dir, '.hodgepodge', 'runs', 'r1', 'qa-1', 'record.json'), JSON.stringify({ status: 'findings', cycle: 1, usage: { seconds: 1 } }));
  writeFileSync(join(dir, '.hodgepodge', 'runs', 'r1', 'qa-1', 'findings.json'), JSON.stringify([finding]));
  mkdirSync(join(dir, '.hodgepodge', 'runs', 'r1', 'qa-2'), { recursive: true });
  writeFileSync(join(dir, '.hodgepodge', 'runs', 'r1', 'qa-2', 'record.json'), JSON.stringify({ status: 'clean', cycle: 2, usage: { seconds: 1 } }));
  writeFileSync(join(dir, '.hodgepodge', 'runs', 'r1', 'qa-2', 'findings.json'), '[]');
  writeDoneReport(dir, 'r1', {
    ok: false,
    suite: { ok: true },
    types: { ok: true },
    requirements: [{ id: 'R-a-1', spec: 'specs/a.md', implementation: 'implemented', status: 'passing', tests: ['test/a.test.js'] }],
    gaps: ['R-b-1: no passing test'],
  });
  return dir;
}

test('readRunDetails lists declared formats per spec', () => {
  const d = readRunDetails(makeRepo(), 'r1');
  assert.deepEqual(d.formats, [
    { spec: 'specs/a.md', format: 'openapi', path: 'api/openapi.yaml' },
    { spec: 'specs/a.md', format: 'json-schema', path: 'schemas/x.json', output: 'out/x.json' },
  ]);
});

test('readRunDetails reports each readiness dimension per spec', () => {
  const d = readRunDetails(makeRepo(), 'r1');
  assert.equal(d.readiness.ready, false);
  assert.ok(d.readiness.gaps > 0);
  const a = d.readiness.specs.find((s) => s.spec === 'specs/a.md');
  assert.equal(a?.dimensions['Actors and goals'], 'covered');
  assert.equal(a?.dimensions['Behaviour'], 'n/a');
  assert.equal(a?.dimensions['Edge cases'], 'gap');
  assert.equal(a?.dimensions['Failure paths'], 'missing');
  const b = d.readiness.specs.find((s) => s.spec === 'specs/b.md');
  assert.equal(b?.dimensions['Acceptance'], 'missing');
});

test('readRunDetails reads QA cycles and findings from runs/<id>/qa-N', () => {
  const d = readRunDetails(makeRepo(), 'r1');
  assert.deepEqual(
    d.qa.map((c) => [c.cycle, c.status, c.findings.length]),
    [[1, 'findings', 1], [2, 'clean', 0]],
  );
  assert.equal(d.qa[0].findings[0].severity, 'high');
});

test('readRunDetails reads done evidence from runs/<id>/done.json', () => {
  const d = readRunDetails(makeRepo(), 'r1');
  assert.equal(d.done?.ok, false);
  assert.equal(d.done?.requirements[0].id, 'R-a-1');
  assert.deepEqual(d.done?.gaps, ['R-b-1: no passing test']);
});

test('readRunDetails on an empty repo has no formats, QA or done evidence', () => {
  const d = readRunDetails(mkdtempSync(join(tmpdir(), 'hodge-details-')), 'none');
  assert.deepEqual(d.formats, []);
  assert.deepEqual(d.qa, []);
  assert.equal(d.done, null);
});

test('readRunDetails ignores unreadable done.json and qa-N records', () => {
  const dir = makeRepo();
  writeFileSync(join(dir, '.hodgepodge', 'runs', 'r1', 'done.json'), '{not json');
  writeFileSync(join(dir, '.hodgepodge', 'runs', 'r1', 'qa-2', 'record.json'), '{not json');
  const d = readRunDetails(dir, 'r1');
  assert.equal(d.done, null);
  assert.deepEqual(d.qa.map((c) => c.cycle), [1]);
});

test('readRunStatus carries details when the source provides them', () => {
  const s = readRunStatus(createLocalStatusSource(makeRepo()), 'r1', budgets);
  assert.equal(s.details.formats.length, 2);
  assert.equal(s.details.qa.length, 2);
});

test('renderFrame shows formats, readiness dimensions, QA findings and done evidence', () => {
  const status = readRunStatus(createLocalStatusSource(makeRepo()), 'r1', budgets);
  const frame = renderFrame({ status, control, tail: [], prompt: null });
  assert.match(frame, /formats\s+openapi api\/openapi\.yaml/);
  assert.match(frame, /json-schema schemas\/x\.json -> out\/x\.json/);
  assert.match(frame, /readiness\s+NOT READY/);
  assert.match(frame, /specs\/a\.md\s+.*Behaviour n\/a/);
  assert.match(frame, /Edge cases GAP/);
  assert.match(frame, /Failure paths MISSING/);
  assert.match(frame, /qa\s+cycle 1 findings \(1\)/);
  assert.match(frame, /high violated-decision specs\/a\.md/);
  assert.match(frame, /qa\s+cycle 2 clean/);
  assert.match(frame, /done\s+NOT DONE\s+1\/1 requirements passing/);
  assert.match(frame, /R-b-1: no passing test/);
});

test('renderFrame says so when nothing is declared, no QA ran and there is no done report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-details-'));
  const status = readRunStatus(createLocalStatusSource(dir), 'r1', budgets);
  const frame = renderFrame({ status, control, tail: [], prompt: null });
  assert.match(frame, /formats\s+none declared/);
  assert.match(frame, /qa\s+not run/);
  assert.match(frame, /done\s+no report/);
});

test('hodgepodge status prints formats, readiness, qa and done in the JSON', async () => {
  const repo = makeRepo();
  const cfg = { roles: { build: { adapter: 'f', model: 'm' } }, budgets, allowedPaths: ['src/'] };
  writeProjectConfig(repo, cfg);
  let out = '';
  const code = await withCwd(repo, () => main(['status', '--run-id', 'r1'], { stdout: (/** @type {string} */ s) => (out += s), stderr: () => {} }));
  assert.equal(code, 0);
  const j = JSON.parse(out);
  assert.equal(j.details.formats.length, 2);
  assert.equal(j.details.readiness.ready, false);
  assert.equal(j.details.qa[0].findings[0].classification, 'violated-decision');
  assert.equal(j.details.done.requirements[0].id, 'R-a-1');
});
