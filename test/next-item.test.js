import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextItem } from '../src/podge-next-item.js';
import { buildPrompt, buildPlanPrompt } from '../src/podge-step.js';
import { MODES, loadModePrompt, loadQaPrompt } from '../src/prompts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('L-1: nextItem returns the first unchecked item with its indented continuation and the open count', () => {
  const plan = ['# plan', '- [x] done one', '- [ ] first open', '  detail line', '  - sub bullet', '', '- [ ] second open', '* [ ] third open'].join('\n');
  const n = nextItem(plan);
  assert.equal(n?.text, '- [ ] first open\n  detail line\n  - sub bullet');
  assert.equal(n?.open, 3);
});

test('L-1: nextItem is null when nothing is unchecked or the plan is empty', () => {
  assert.equal(nextItem('- [x] a\n- [x] b'), null);
  assert.equal(nextItem(''), null);
  assert.equal(nextItem('| ID | Task |\n| 1 | todo |'), null);
});

test('L-1: nextItem caps a runaway item', () => {
  const n = nextItem(`- [ ] big\n${'  x\n'.repeat(2000)}`);
  assert.ok(n && n.text.length <= 1500);
});

/** @param {string} plan */
function repoWithPlan(plan) {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-next-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  mkdirSync(join(dir, 'specs'));
  writeFileSync(join(dir, 'specs', 'a.md'), '# Spec A\n- rule\n');
  writeFileSync(join(dir, 'plan.md'), plan);
  return dir;
}

const bigPlan = () => `# plan\n${Array.from({ length: 500 }, (_, i) => `- [${i < 100 ? 'x' : ' '}] ITEM-${i} ${'lorem ipsum '.repeat(20)}`).join('\n')}\n`;

test('L-1: the loop prompt carries only the next item, never the rest of plan.md', () => {
  const p = buildPrompt(repoWithPlan(bigPlan()));
  assert.match(p, /ITEM-100\b/);
  assert.doesNotMatch(p, /ITEM-99\b/);
  assert.doesNotMatch(p, /ITEM-101\b/);
  assert.match(p, /399 more/);
});

test('L-2: the assembled loop prompt stays under 4 KB however large plan.md grows', () => {
  assert.ok(Buffer.byteLength(buildPrompt(repoWithPlan(bigPlan()))) < 4096);
});

test('L-2: plan and QA prompts do not inline plan.md', () => {
  const dir = repoWithPlan(bigPlan());
  assert.doesNotMatch(buildPlanPrompt(dir), /ITEM-/);
});

test('L-2: build and plan prompts are at most 120 words, others at most 150', () => {
  const words = (/** @type {string} */ p) => p.trim().split(/\s+/).length;
  for (const m of MODES) assert.ok(words(loadModePrompt(m)) <= (['interview', 'test-hardening'].includes(m) ? 150 : 120), `${m} prompt too long`);
  assert.ok(words(loadQaPrompt()) <= 150, 'qa prompt too long');
});

test('L-2: AGENTS.md and every mode prompt file stay small', () => {
  assert.ok(statSync(join(root, 'AGENTS.md')).size <= 2800, 'AGENTS.md too large');
  const dir = join(root, 'prompts');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    assert.ok(statSync(join(dir, f)).size <= 1800, `${f} too large`);
  }
});
