import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSpecificationItems, runPlanLoop, buildPlanPrompt } from '../../src/bash/bash-planner.js';
import plannerPrompt from '../../src/bash/prompts/bash-planner.js';

test('parseSpecificationItems reads each numbered `N. [ ] C: ... B: ...` line, tolerating a `C (Q1):` reference', () => {
  const items = parseSpecificationItems([
    '# Specification',
    '1. [ ] C (Q1): Provide a login screen. B: Users can authenticate.',
    '2. [x] C: Already specified. B (impact): done already',
  ].join('\n'));
  assert.deepEqual(items.map((i) => [i.id, i.checked, i.constraint, i.benefit]), [
    [1, false, 'Provide a login screen.', 'Users can authenticate.'],
    [2, true, 'Already specified.', 'done already'],
  ]);
});

test('buildPlanPrompt is the single planning prompt', () => {
  const p = buildPlanPrompt();
  assert.equal(p, plannerPrompt());
});

function setup(planText) {
  const dir = mkdtempSync(join(tmpdir(), 'bash-plan-'));
  const planPath = join(dir, 'plan.md');
  writeFileSync(planPath, '# Plan\n');
  const calls = [];
  const adapter = {
    run: async (req) => {
      calls.push(req);
      if (planText) writeFileSync(planPath, planText);
      req.onReasoning?.('thinking it through');
      return { exitStatus: 0, transcript: '' };
    },
  };
  return { planPath, calls, adapter };
}

const run = (s, extra = {}) =>
  runPlanLoop({ planPath: s.planPath, readFile: (p) => readFileSync(p, 'utf8'), say: () => {}, adapter: s.adapter, ...extra });

test('runPlanLoop makes one fresh-context agent call and reports the items written to plan.md', async () => {
  const s = setup('# Plan\n\n1. [ ] T: Create index.html - page S: 1\n2. [x] T: Done thing\n');
  const logs = [];
  const res = await run(s, { log: (src, text) => logs.push([src, text]) });
  assert.deepEqual(res, { status: 'ok', items: 2, open: 1, first: 'Create index.html' });
  assert.equal(s.calls.length, 1);
  assert.ok(!('session' in s.calls[0]));
  assert.equal(s.calls[0].prompt, buildPlanPrompt());
  assert.deepEqual(logs.map((l) => l[0]), ['bash/planner prompt', 'bash/planner response']);
  assert.equal(logs[1][1], 'thinking it through');
});

test('runPlanLoop throws, with the agent output, when plan.md has no items afterwards', async () => {
  const s = setup(null);
  await assert.rejects(run(s), /wrote no plan items.*thinking it through/s);
});
