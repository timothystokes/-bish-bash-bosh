// bish-log.md: a plain-text, append-only transcript of every prompt sent to the agent and every
// piece of the agent's own output shown in the console (never the raw JSON an adapter's `--debug`
// might emit). Each entry is one timestamped line, `[<ISO timestamp>] <source>: <text>` — `bish`
// for a prompt this harness sent, `agent` for text the agent streamed back — so the owner can read
// back exactly what was sent and what came back, in order, without re-running anything.
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
