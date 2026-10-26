/**
 * @typedef {{n: number, topic: string, text: string, default: string}} BatchQuestion
 * @typedef {{n: number, answer: string, source: 'default' | 'owner'}} BatchAnswer
 */

/**
 * A batch is `## <topic>` headings over numbered `N. <question> Default: <answer>` lines.
 * @param {string} text
 * @returns {BatchQuestion[] | null} null when the text has no numbered question (a single free-form question)
 * @throws {Error} on a numbered question without a Default or a repeated number
 */
export function parseBatch(text) {
  /** @type {BatchQuestion[]} */
  const out = [];
  let topic = 'General';
  for (const line of text.split('\n')) {
    const heading = /^#{1,6}\s+(?:Topic:\s*)?(.+?)\s*$/.exec(line);
    if (heading) {
      topic = heading[1];
      continue;
    }
    const q = /^\s*(\d+)\.\s+(.*\S)\s*$/.exec(line);
    if (!q) continue;
    const n = Number(q[1]);
    const split = /^(.*?)\s*\bDefault:\s*(.*)$/.exec(q[2]);
    if (!split || split[2].trim() === '') throw new Error(`question ${n} needs a "Default: <answer>"`);
    if (out.some((x) => x.n === n)) throw new Error(`duplicate question number ${n}`);
    out.push({ n, topic, text: split[1], default: split[2].trim() });
  }
  return out.length === 0 ? null : out;
}

const HINT = 'answer with "N: answer; M: answer" (unlisted questions keep their defaults), or y for all defaults';

/**
 * @param {BatchQuestion[]} batch
 * @param {string} input
 * @returns {{ok: true, answers: BatchAnswer[]} | {ok: false, reason: string}}
 */
export function resolveAnswer(batch, input) {
  const text = input.trim();
  /** @returns {BatchAnswer[]} */
  const fromDefaults = () => batch.map((q) => ({ n: q.n, answer: q.default, source: 'default' }));
  if (/^(y|yes)$/i.test(text)) return { ok: true, answers: fromDefaults() };
  const pairs = [...text.matchAll(/(?:^|[;\n])\s*(\d+)\s*[:=]\s*([^;\n]*)/g)];
  const rest = pairs.reduce((s, m) => s.replace(m[0], ''), text).replace(/[;\s]/g, '');
  if (pairs.length === 0 || rest !== '') return { ok: false, reason: `Not understood: ${HINT}.` };
  /** @type {BatchAnswer[]} */
  const answers = fromDefaults();
  for (const m of pairs) {
    const n = Number(m[1]);
    const a = answers.find((x) => x.n === n);
    if (!a) return { ok: false, reason: `No question with index ${n}: ${HINT}.` };
    if (m[2].trim() === '') return { ok: false, reason: `Empty answer for ${n}: ${HINT}.` };
    a.answer = m[2].trim();
    a.source = 'owner';
  }
  return { ok: true, answers };
}

/**
 * @param {BatchQuestion[]} batch
 * @param {BatchAnswer[]} answers
 * @returns {string}
 */
export function formatBatchLog(batch, answers) {
  return batch
    .map((q) => {
      const a = /** @type {BatchAnswer} */ (answers.find((x) => x.n === q.n));
      return `Q${q.n} [${q.topic}] ${q.text}\n  A${q.n} (${a.source}): ${a.answer}`;
    })
    .join('\n');
}

export const BATCH_HINT = 'type y to accept all defaults, "N: answer; M: answer" to change some (the rest keep their defaults), or done to end the interview';
