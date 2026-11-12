// bish-log.md: a plain-text, append-only transcript of every prompt sent to the agent and every
// piece of the agent's own output shown in the console (never the raw JSON an adapter's `--debug`
// might emit). Each entry is one timestamped line, `[<ISO timestamp>] <persona> <kind>: <text>`.
// The persona names which agent role the call belongs to (`bish/bootstrap`, `bish/interviewer`,
// `bash/planner`, `bosh/tester`, `bosh/builder`, `bosh/verifier`; `bosh/harness` for the harness's own gate
// results) and the kind is `prompt` (what the harness sent) or `response` (the text the agent streamed
// back), so the owner can read back exactly who was asked what and what came back, in order.
import { appendFileSync } from 'node:fs';

/**
 * Builds a logger that appends one `[timestamp] source: text` entry per call to `logPath`.
 * @param {string} logPath
 * @param {(p: string, s: string) => void} [appendFile]
 * @returns {(source: string, text: string) => void}
 */
export function createLogger(logPath, appendFile = (p, s) => appendFileSync(p, s)) {
  return (source, text) => {
    if (!text) return;
    appendFile(logPath, `[${new Date().toISOString()}] ${source}: ${text}\n`);
  };
}
