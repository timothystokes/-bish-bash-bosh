// The Interview Loop: a pure, deterministic, no-agent walk through `.hodgepodge/interview.md`'s
// checkbox format (see templates/interview-template.md). Each question block has two independent
// checkboxes: `Q` (left for a later, not-yet-built spec-drafting step) and `A` (marked by this loop
// once the owner has answered). This loop only ever reads and marks the `A` checkbox.

const CYAN = '\x1b[1;36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const BLOCK = /^# (\d+)\s*$/;
const Q_LINE = /^\[([ x])\] Q:\s?(.*)$/;
const A_LINE = /^\[([ x])\] A:\s?(.*)$/;

// Parses the checkbox blocks out of an interview.md's text. Returns one entry per well-formed
// `# N` / `[ ] Q: ...` / `[ ] A: ...` triplet, with the line index of its `A:` line so the loop can
// rewrite just that line in place.
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

// Runs the loop against `interview.md` in `repoDir`: finds the next unanswered question, shows it
// in color, awaits an answer on stdin (Enter alone accepts whatever default text already follows
// `A:`), writes the answer back with its checkbox marked, and repeats. Stops at EOF (paused, so a
// restart resumes where it left off) or once no unanswered question remains (ok).
export async function runInterviewLoop({ interviewPath, readFile, writeFile, ask, say }) {
  let answered = 0;
  for (;;) {
    const text = readFile(interviewPath);
    const questions = parseQuestions(text);
    const next = nextQuestion(questions);
    if (!next) return { status: 'ok', answered };
    say(`\n${CYAN}Q: ${next.question}${RESET}\n`);
    const suffix = next.answer ? ` [${next.answer}]` : '';
    const reply = await ask(`${YELLOW}A:${suffix} ${RESET}`);
    if (reply === null) {
      const remaining = parseQuestions(readFile(interviewPath)).filter((q) => !q.qChecked && !q.aChecked).length;
      return { status: 'paused', answered, remaining };
    }
    const answer = reply.trim() === '' ? next.answer : reply.trim();
    const lines = text.split('\n');
    lines[next.aLineIndex] = `[x] A: ${answer}`;
    writeFile(interviewPath, lines.join('\n'));
    answered++;
  }
}
