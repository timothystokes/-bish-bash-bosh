// The Interview Loop: a deterministic walk through `.hodgepodge/interview.md`'s checkbox format
// (see templates/interview-template.md). Each question block has two independent checkboxes: `Q`
// (ticked once this round has been handed to the agent) and `A` (ticked as soon as the owner has
// answered, before the agent call). Finding the next question to ask only ever looks at these two
// checkboxes; the loop never reads or writes anything else about a question's history.
import { loadModePrompt } from './prompts.js';

const CYAN = '\x1b[1;36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const BLOCK = /^# (\d+)\s*$/;
const Q_LINE = /^\[([ x])\] Q:\s?(.*)$/;
const A_LINE = /^\[([ x])\] A:\s?(.*)$/;

// Parses the checkbox blocks out of an interview.md's text. Returns one entry per well-formed
// `# N` / `[ ] Q: ...` / `[ ] A: ...` triplet, with the line index of its `A:` line so the loop can
// rewrite just that line in place (the `Q:` line is always the line directly above it).
export function parseQuestions(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const id = BLOCK.exec(lines[i]);
    if (!id) continue;
    const q = Q_LINE.exec(lines[i + 1] ?? '');
    const a = A_LINE.exec(lines[i + 2] ?? '');
    if (!q || !a) continue;
    out.push({
      id: Number(id[1]),
      qChecked: q[1] === 'x',
      question: q[2].trim(),
      aChecked: a[1] === 'x',
      answer: a[2].trim(),
      aLineIndex: i + 2,
    });
  }
  return out;
}

// The next question to ask: the first block where neither checkbox is checked yet.
export function nextQuestion(questions) {
  return questions.find((q) => !q.qChecked && !q.aChecked) ?? null;
}

// The agent's prompt for one round: prompts/interview-loop.md's instructions, prefaced onto this
// round's question and answer. The agent is expected to update .hodgepodge/spec.md and, if it
// judges the spec still incomplete, append further question blocks to interview.md itself.
export function buildInterviewLoopPrompt(question, answer) {
  return [loadModePrompt('interview'), '## Question', question, '## Answer', answer].join('\n\n');
}

// Ticks a question block's `Q` checkbox by id, re-reading the file first since the agent's own
// call may have already changed it (e.g. appended more questions). A block the agent removed is
// left alone rather than erroring: the round's answer already landed, which is what matters.
function markAsked(interviewPath, readFile, writeFile, id) {
  const text = readFile(interviewPath);
  const q = parseQuestions(text).find((x) => x.id === id);
  if (!q) return;
  const lines = text.split('\n');
  lines[q.aLineIndex - 1] = `[x] Q: ${q.question}`;
  writeFile(interviewPath, lines.join('\n'));
}

// Runs the loop against `interview.md` in `repoDir`: finds the next unanswered question, shows it
// in color, awaits an answer on stdin (a real terminal pre-fills the existing default right onto
// the `A: ` line, editable like anything typed; Enter alone accepts it as-is, and Backspace/Delete
// erase it character by character, leaving `A: ` ready for a fresh answer), writes the answer back
// with its checkbox marked, then hands the question and answer to
// the agent (one call per round, prompts/interview-loop.md's job) before ticking the `Q` checkbox
// too. `loadSession`/`saveSession` thread one continuing agent session through every round, and
// across separate `hodge` invocations (the caller persists it, e.g. to a file), so the agent keeps
// the whole conversation's context rather than starting fresh each time. Stops at EOF (paused, so
// a restart resumes where it left off) or once no unanswered question remains (ok).
/**
 * @param {{
 *   interviewPath: string,
 *   readFile: (p: string) => string,
 *   writeFile: (p: string, s: string) => void,
 *   ask: (prompt: string, defaultValue?: string) => Promise<string | null>,
 *   say: (s: string) => void,
 *   adapter: { run: (req: object) => Promise<{ session?: unknown }> },
 *   repoDir?: string,
 *   loadSession?: () => unknown,
 *   saveSession?: (session: unknown) => void,
 * }} opts
 */
export async function runInterviewLoop({
  interviewPath,
  readFile,
  writeFile,
  ask,
  say,
  adapter,
  repoDir,
  loadSession = () => undefined,
  saveSession = (/** @type {unknown} */ _session) => {},
}) {
  let answered = 0;
  for (;;) {
    const text = readFile(interviewPath);
    const questions = parseQuestions(text);
    const next = nextQuestion(questions);
    if (!next) return { status: 'ok', answered };
    say(`\n${CYAN}Q: ${next.question}${RESET}\n`);
    const reply = await ask(`${YELLOW}A: ${RESET}`, next.answer);
    if (reply === null) {
      const remaining = parseQuestions(readFile(interviewPath)).filter((q) => !q.qChecked && !q.aChecked).length;
      return { status: 'paused', answered, remaining };
    }
    const answer = reply.trim() === '' ? next.answer : reply.trim();
    const lines = text.split('\n');
    lines[next.aLineIndex] = `[x] A: ${answer}`;
    writeFile(interviewPath, lines.join('\n'));

    const prompt = buildInterviewLoopPrompt(next.question, answer);
    const result = await adapter.run({ prompt, cwd: repoDir, limits: {}, session: loadSession() });
    saveSession(result.session);

    markAsked(interviewPath, readFile, writeFile, next.id);
    answered++;
  }
}
