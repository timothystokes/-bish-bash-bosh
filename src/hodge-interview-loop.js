// The Interview Loop: a deterministic walk through `.hodgepodge/interview.md`'s numbered-line format
// (see templates/interview-template.md): one line per question, `<n>. [ ] Q: <question> A: <answer>.`,
// with a single checkbox ticked only once that round has been fully handed to and processed by the
// agent. Finding the next question to ask only ever looks at that one checkbox; the loop never reads
// or writes anything else about a question's history.
import { loadModePrompt } from './prompts.js';

const CYAN = '\x1b[1;36m';
const YELLOW = '\x1b[33m';
const GREY = '\x1b[90m';
const RESET = '\x1b[0m';

const LINE = /^(\d+)\.\s*\[([ x])\]\s*Q:\s*(.*?)\s*A\s*(?:\([^)]*\))?:\s*(.*)$/;

// Parses the numbered question lines out of an interview.md's text. Returns one entry per
// well-formed `<n>. [ ] Q: <question> A: <answer>` line, with its line index so the loop can
// rewrite it in place. Tolerates a parenthetical remark between `A` and `:` (e.g. an agent
// writing `A (default):` instead of the canonical `A:`), so a line is never silently dropped
// over a label the agent phrased slightly differently; it's rewritten to the canonical form
// (see renderLine) the next time that line is written back.
export function parseQuestions(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i]);
    if (!m) continue;
    out.push({
      id: Number(m[1]),
      checked: m[2] === 'x',
      question: m[3].trim(),
      answer: m[4].trim(),
      lineIndex: i,
    });
  }
  return out;
}

// The next question to ask: the first line not yet checked.
export function nextQuestion(questions) {
  return questions.find((q) => !q.checked) ?? null;
}

// The agent's prompt for one round: prompts/interview-loop.md's instructions, prefaced onto this
// round's question and answer. The agent is expected to update .hodgepodge/specification.md and, if it
// judges the spec still incomplete, append further question lines to interview.md itself.
export function buildInterviewLoopPrompt(question, answer) {
  return [loadModePrompt('interview'), '## Question', question, '## Answer', answer].join('\n\n');
}

// Renders one question line, checked or not, with its current question/answer text.
function renderLine(id, checked, question, answer) {
  return `${id}. [${checked ? 'x' : ' '}] Q: ${question} A: ${answer}`;
}

// Ticks a question line's checkbox by id, re-reading the file first since the agent's own call may
// have already changed it (e.g. appended more questions). A line the agent removed is left alone
// rather than erroring: the round's answer already landed, which is what matters.
function markProcessed(interviewPath, readFile, writeFile, id) {
  const text = readFile(interviewPath);
  const q = parseQuestions(text).find((x) => x.id === id);
  if (!q) return;
  const lines = text.split('\n');
  lines[q.lineIndex] = renderLine(q.id, true, q.question, q.answer);
  writeFile(interviewPath, lines.join('\n'));
}

// Runs the loop against `interview.md` in `repoDir`: finds the next unprocessed question, shows it
// in color, awaits an answer on stdin (a real terminal shows the existing default in grey, ahead of
// the cursor; Enter alone accepts it as-is — turning it yellow to match the `A:` label as it's
// accepted — any other key clears the whole thing in one go and starts a fresh answer in the same
// yellow — see `createAsker`), writes the answer back into that line (checkbox still unticked),
// prints a "Thinking..." line, hands exactly that round's question and answer to the agent (one
// call per round, prompts/interview-loop.md's job), then ticks the line's checkbox once the agent
// has finished. `loadSession`/`saveSession` thread one continuing agent session through every
// round, and across separate `hodge` invocations (the caller persists it, e.g. to a file), so the
// agent keeps the whole conversation's context rather than starting fresh each time. Stops at EOF
// (paused, so a restart resumes where it left off) or once no unprocessed question remains (ok).
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
    const reply = await ask(`${YELLOW}A:  `, next.answer);
    say(RESET);
    if (reply === null) {
      const remaining = parseQuestions(readFile(interviewPath)).filter((q) => !q.checked).length;
      return { status: 'paused', answered, remaining };
    }
    const answer = reply.trim() === '' ? next.answer : reply.trim();
    const lines = text.split('\n');
    lines[next.lineIndex] = renderLine(next.id, false, next.question, answer);
    writeFile(interviewPath, lines.join('\n'));

    say(`${GREY}Thinking...${RESET}\n`);
    const prompt = buildInterviewLoopPrompt(next.question, answer);
    const result = await adapter.run({ prompt, cwd: repoDir, limits: {}, session: loadSession() });
    saveSession(result.session);

    markProcessed(interviewPath, readFile, writeFile, next.id);
    answered++;
  }
}
