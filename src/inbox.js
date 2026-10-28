import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Outer-console files, kept in the sandbox (outside the target repo), one bullet per entry. */
export const INBOX_FILE = { hodge: 'more-questions.md', podge: 'more-todos.md' };

export function addEntry(dir, kind, text) {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line === '') throw new Error('empty entry');
  appendFileSync(join(dir, INBOX_FILE[kind]), `- ${line}\n`);
}

export function readInbox(dir, kind) {
  const file = join(dir, INBOX_FILE[kind]);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

// Removes the entries that were used, keeping any the console added since they were read.
export function consumeInbox(dir, kind, used) {
  if (used === '') return;
  const file = join(dir, INBOX_FILE[kind]);
  const cur = readInbox(dir, kind);
  const rest = cur.startsWith(used) ? cur.slice(used.length) : cur;
  if (rest === '') {
    rmSync(file, { force: true });
    return;
  }
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, rest);
  renameSync(tmp, file);
}

const INTRO = {
  hodge: 'The owner added these while you ran. Assess each, add it to the open questions (objective/), and ask it in the next batch unless it is already answered.',
  podge: 'The owner added these while you ran. End-of-session checklist: add each to plan.md as an unchecked item before you assess the next best action.',
};

export function inboxSection(kind, entries) {
  if (entries.trim() === '') return [];
  return [`## ${kind === 'hodge' ? 'More questions' : 'More todos'}`, INTRO[kind], entries.trimEnd()];
}
