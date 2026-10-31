import { randomUUID } from 'node:crypto';
import { runProcessAgent } from './process.js';

// Arguments for a non-interactive Claude Code run. `sessionId` (set by the caller once it opts
// into session tracking, see createClaudeCodeAdapter below) starts a brand-new conversation with
// that id the first time, and continues it (`--resume`) on every later call with the same id.
/** @param {{ prompt: string, model?: string, sessionId?: string, resume?: boolean }} args */
export function buildClaudeArgs({ prompt, model, sessionId, resume }) {
  const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
  if (model) args.push('--model', model);
  if (sessionId) args.push(resume ? '--resume' : '--session-id', sessionId);
  return args;
}

// Parse `--output-format json` output: a result object (or an array containing one).
// Unparseable output becomes the transcript.
export function parseClaudeOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { transcript: stdout.trim() };
  }
  const ev = Array.isArray(parsed) ? [...parsed].reverse().find((e) => e?.type === 'result') : parsed;
  if (!ev || typeof ev !== 'object') return { transcript: stdout.trim() };
  return { transcript: typeof ev.result === 'string' ? ev.result : '' };
}

// Adapter driving Claude Code in non-interactive mode. Session tracking is opt-in: a caller that
// never passes `session` gets the old stateless behaviour unchanged (no `--session-id`/`--resume`
// flag at all). A caller that passes `session` (undefined on its first call, then whatever this
// run returned) gets a real, resumed Claude Code conversation across calls.
export function createClaudeCodeAdapter(opts = {}) {
  const command = opts.command ?? 'claude';
  const prefix = opts.prefixArgs ?? [];
  return {
    async run(req) {
      const { prompt, cwd, limits, onOutput = undefined } = req;
      const tracking = Object.hasOwn(req, 'session');
      const resume = tracking && Boolean(req.session);
      const sessionId = tracking ? (resume ? req.session : randomUUID()) : undefined;
      const { code, stdout, stderr, timedOut, changedFiles } = await runProcessAgent({
        command,
        args: [...prefix, ...buildClaudeArgs({ prompt, model: opts.model, sessionId, resume })],
        cwd,
        env: opts.env,
        maxWallClockSeconds: limits.maxWallClockSeconds,
        onOutput,
      });
      const parsed = parseClaudeOutput(stdout);
      const exitStatus = timedOut ? 124 : code;
      const transcript = stderr ? `${parsed.transcript}\n[stderr]\n${stderr}` : parsed.transcript;
      return { exitStatus, transcript, changedFiles, ...(tracking ? { session: sessionId } : {}) };
    },
  };
}
