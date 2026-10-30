import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadInterviewIntro } from './prompts.js';

// The question store (`.hodgepodge/interview.md`) is owned by code: the agent never reads or edits it. Code
// picks the batch to ask, records the owner's answers, hands only those answers to the agent, and updates each
// question's status from the agent's `.hodgepodge/response.json`.

export const STORE_HEADER = loadInterviewIntro();

export const MAX_BATCH_TOPICS = 3;
export const MAX_BATCH_QUESTIONS = 8;

const clean = (s) => s.replace(/\s*\n\s*/g, ' ').replace(/\s*;\s*/g, ', ').trim();
const normal = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function parseQuestions(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^(\d+) - Answered: \[([ x])\]; Specified: \[([ x])\]; (.*)$/.exec(line);
    if (!m) continue;
    const q = { id: Number(m[1]), topic: '', text: '', default: '', specified: m[3] === 'x' };
    for (const f of m[4].split('; ')) {
      const kv = /^(Topic|Q|Default|A|Spec): (.*)$/.exec(f);
      if (!kv) continue;
      if (kv[1] === 'Topic') q.topic = kv[2];
      else if (kv[1] === 'Q') q.text = kv[2];
      else if (kv[1] === 'Default') q.default = kv[2];
      else if (kv[1] === 'A') q.answer = kv[2];
      else if (kv[1] === 'Spec') q.spec = kv[2];
    }
    out.push(q);
  }
  return out;
}

export function formatQuestions(questions) {
  const lines = questions.map((q) => {
    const fields = [
      `Topic: ${clean(q.topic)}`,
      `Q: ${clean(q.text)}`,
      q.answer === undefined ? `Default: ${clean(q.default)}` : `A: ${clean(q.answer)}`,
      q.spec ? `Spec: ${clean(q.spec)}` : '',
    ].filter(Boolean);
    return `${q.id} - Answered: [${q.answer === undefined ? ' ' : 'x'}]; Specified: [${q.specified ? 'x' : ' '}]; ${fields.join('; ')}`;
  });
  return `${STORE_HEADER}${lines.length ? `\n${lines.join('\n')}\n` : ''}`;
}

export const unanswered = (qs) => qs.filter((q) => !q.specified && q.answer === undefined);

export const pendingAnswers = (qs) => qs.filter((q) => !q.specified && q.answer !== undefined);

// The next batch to ask, in store order: at most 3 topics and 8 questions.
export function nextBatch(qs) {
  const open = unanswered(qs);
  const topics = [...new Set(open.map((q) => q.topic))].slice(0, MAX_BATCH_TOPICS);
  return topics
    .flatMap((t) => open.filter((q) => q.topic === t))
    .slice(0, MAX_BATCH_QUESTIONS)
    .map((q) => ({ n: q.id, topic: q.topic, text: q.text, default: q.default }));
}

export function renderBatch(batch) {
  const topics = [...new Set(batch.map((q) => q.topic))];
  return topics
    .map((t) => `## ${t}\n${batch.filter((q) => q.topic === t).map((q) => `${q.n}. ${q.text} Default: ${q.default}`).join('\n')}`)
    .join('\n\n');
}

const HINT = 'answer with "N: answer" (one per line), or ok to continue with the remaining defaults';

// The owner answers a batch one line at a time: each line either overrides one or more defaults ("N: answer",
// `;`-separated for more than one) or, once satisfied, types "ok" to continue with whatever defaults were not
// overridden. This only parses a single line's overrides; `hodge-objective.js` accumulates them across lines.
export function resolveAnswer(batch, input) {
  const text = input.trim();
  const pairs = [...text.matchAll(/(?:^|[;\n])\s*(\d+)\s*[:=]\s*([^;\n]*)/g)];
  const rest = pairs.reduce((s, m) => s.replace(m[0], ''), text).replace(/[;\s]/g, '');
  if (pairs.length === 0 || rest !== '') return { ok: false, reason: `Not understood: ${HINT}.` };
  const overrides = [];
  for (const m of pairs) {
    const n = Number(m[1]);
    if (!batch.some((q) => q.n === n)) return { ok: false, reason: `No question with index ${n}: ${HINT}.` };
    if (m[2].trim() === '') return { ok: false, reason: `Empty answer for ${n}: ${HINT}.` };
    overrides.push({ n, answer: m[2].trim() });
  }
  return { ok: true, overrides };
}

export function recordAnswers(qs, answers) {
  return qs.map((q) => {
    const a = answers.find((x) => x.n === q.id);
    return a ? { ...q, answer: clean(a.answer) } : q;
  });
}

export function parseResponse(text, answered) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  const isStr = (s) => typeof s === 'string' && s.trim() !== '';
  if (!j || typeof j !== 'object' || !Array.isArray(j.resolved) || !Array.isArray(j.gaps)) return { ok: false, reason: 'needs "resolved" and "gaps" arrays' };
  for (const r of j.resolved) {
    if (!r || !answered.includes(r.id)) return { ok: false, reason: `resolved id ${r?.id} was not answered this round` };
    if (!isStr(r.spec)) return { ok: false, reason: `resolved id ${r.id} needs a "spec"` };
  }
  for (const g of j.gaps) {
    if (!g || !isStr(g.topic) || !isStr(g.question) || !isStr(g.default)) return { ok: false, reason: 'every gap needs "topic", "question" and "default"' };
  }
  return { ok: true, response: j };
}

// Answered questions the agent resolved become specified with their spec; answered ones it did not resolve are asked
// again with the owner's answer as the default; gaps become new questions (a gap repeating an existing question is dropped).
export function applyResponse(qs, response) {
  const out = qs.map((q) => {
    if (q.specified || q.answer === undefined) return q;
    const r = response.resolved.find((x) => x.id === q.id);
    return r ? { ...q, specified: true, spec: clean(r.spec) } : { id: q.id, topic: q.topic, text: q.text, default: q.answer, specified: false };
  });
  let next = Math.max(0, ...out.map((q) => q.id)) + 1;
  for (const g of response.gaps) {
    if (out.some((q) => normal(q.text) === normal(g.question))) continue;
    out.push({ id: next++, topic: clean(g.topic), text: clean(g.question), default: clean(g.default), specified: false });
  }
  return out;
}

export const BATCH_HINT = 'enter "N: answer" to overwrite defaults, one per line; enter ok when ready to continue with the remaining defaults';

const storePath = (repoDir) => join(repoDir, '.hodgepodge', 'interview.md');

export function readQuestions(repoDir) {
  return existsSync(storePath(repoDir)) ? parseQuestions(readFileSync(storePath(repoDir), 'utf8')) : [];
}

export function writeQuestions(repoDir, qs) {
  writeFileSync(storePath(repoDir), formatQuestions(qs));
}
