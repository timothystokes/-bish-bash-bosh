// The Interview Loop: a deterministic walk through `.bish-bash-bosh/interview.md`'s numbered-line format
// (see src/bish/templates/bish-interview.md): one line per question, `<n>. [ ] Q: <question> A: <answer>.`,
// with a single checkbox ticked only once that round has been fully handed to and processed by the
// agent. Finding the next question to ask only ever looks at that one checkbox; the loop never reads
// or writes anything else about a question's history.
import analystIntroPrompt from './prompts/bish-analyst-intro.js';
import analystLoopPrompt from './prompts/bish-analyst-loop.js';
import { subject } from '../shared/git-commit.js';

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
export function parseInterview(text) {
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

// The agent's prompt for one round: src/bish/prompts/bish-analyst-loop.js's instructions, prefaced onto this
// round's question and answer. The agent is expected to update .bish-bash-bosh/specification.md and, if it
// judges the spec still incomplete, append further question lines to interview.md itself.
// `includeIntro` prefaces src/bish/prompts/bish-analyst-intro.js onto the very top of all of that: the caller
// passes it only for the first round of a brand-new session (see runInterviewLoop below), never for
// a later round or a restart that resumes the same persisted session.
export function buildInterviewLoopPrompt(question, answer, { includeIntro = false } = {}) {
  const parts = [];
  if (includeIntro) parts.push(analystIntroPrompt().trimEnd());
  parts.push(analystLoopPrompt(['## Question', question, '## Answer', answer].join('\n\n')));
  return parts.join('\n\n');
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
  const q = parseInterview(text).find((x) => x.id === id);
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
// prints a "Analyst thinking..." line, hands exactly that round's question and answer to the agent (one
// call per round, src/bish/prompts/bish-analyst-loop.js's job), streaming the agent's own live reasoning text
// (if any) on the following line, in the same grey, via the adapter contract's opt-in `onReasoning`
// callback — adapters that have no such concept simply never call it, so this is a no-op there —
// then ticks the line's checkbox once the agent has finished. `loadSession`/`saveSession` thread
// one continuing agent session through every round, and across separate `bish` invocations (the
// caller persists it, e.g. to a file), so the agent keeps the whole conversation's context rather
// than starting fresh each time; the very first round of a brand-new session (no session persisted
// yet) also prefaces src/bish/prompts/bish-analyst-intro.js onto that one call only — never again for a later
// round or a restart that resumes the same session. Stops at EOF (paused, so a restart resumes
// where it left off) or once no unprocessed question remains (ok). `log` (see bish-log.js), if
// given, is called once per round with the full prompt sent (`'bish'`) and, if the agent streamed
// any reasoning text, the full accumulated text of that stream (`'agent'`) — never the raw JSON
// behind either, and never the Q/A/"Analyst thinking..." lines shown on screen, only the prompt in and the
// agent's own output out.
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
 *   commit?: (message: string) => unknown,
 *   log?: (source: string, text: string) => void,
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
  commit = () => {},
  log = (/** @type {string} */ _source, /** @type {string} */ _text) => {},
}) {
  let answered = 0;
  for (;;) {
    const text = readFile(interviewPath);
    const questions = parseInterview(text);
    const next = nextQuestion(questions);
    if (!next) return { status: 'ok', answered };
    say(`\n${CYAN}Q: ${next.question}${RESET}\n`);
    const reply = await ask(`${YELLOW}A: `, next.answer);
    say(RESET);
    if (reply === null) {
      const remaining = parseInterview(readFile(interviewPath)).filter((q) => !q.checked).length;
      return { status: 'paused', answered, remaining };
    }
    const answer = reply.trim() === '' ? next.answer : reply.trim();
    const lines = text.split('\n');
    lines[next.lineIndex] = renderLine(next.id, false, next.question, answer);
    writeFile(interviewPath, lines.join('\n'));

    say(`${GREY}Analyst thinking...\n`);
    const session = loadSession();
    const prompt = buildInterviewLoopPrompt(next.question, answer, { includeIntro: session === undefined });
    log('bish/analyst prompt', prompt);
    let reasoning = '';
    const result = await adapter.run({
      prompt,
      cwd: repoDir,
      limits: {},
      session,
      onReasoning: (chunk) => {
        reasoning += chunk;
        say(chunk);
      },
    });
    say(`${RESET}\n`);
    if (reasoning) log('bish/analyst response', reasoning);
    saveSession(result.session);

    markProcessed(interviewPath, readFile, writeFile, next.id);
    answered++;
    commit(`bish: ${subject(next.question)}\n\nAnswer: ${answer}`);
  }
}
