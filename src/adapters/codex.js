import { runProcessAgent } from './process.js';

// Arguments for a non-interactive Codex run (`codex exec`, JSONL events on stdout). `resumeId`
// (set by the caller once it opts into session tracking, see createCodexAdapter below) switches
// to `codex exec resume <id> ...`, continuing that session instead of starting a new one; Codex
// assigns the session id itself (see parseCodexOutput's `threadId`), it cannot be chosen upfront.
/** @param {{ prompt: string, model?: string, resumeId?: string }} args */
export function buildCodexArgs({ prompt, model, resumeId }) {
  const args = ['exec'];
  if (resumeId) args.push('resume', resumeId);
  args.push('--json', '--dangerously-bypass-approvals-and-sandbox');
  if (model) args.push('--model', model);
  args.push(prompt);
  return args;
}

// Parse `codex exec --json` JSONL: agent_message items form the transcript; `thread.started`
// carries the session id a later call can resume with.
export function parseCodexOutput(stdout) {
  const messages = [];
  let events = 0;
  let threadId;
  for (const line of stdout.split('\n')) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') continue;
    events++;
    if (ev.type === 'thread.started' && typeof ev.thread_id === 'string') threadId = ev.thread_id;
    if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && typeof ev.item.text === 'string') messages.push(ev.item.text);
  }
  if (events === 0) return { transcript: stdout.trim() };
  return { transcript: messages.join('\n'), threadId };
}

// Adapter driving Codex in non-interactive mode. Session tracking is opt-in: a caller that never
// passes `session` gets the old stateless behaviour unchanged (plain `codex exec`, no resume, no
// `session` in the result). A caller that passes `session` (undefined on its first call, then
// whatever this run returned) gets a real, resumed Codex session across calls.
export function createCodexAdapter(opts = {}) {
  const command = opts.command ?? 'codex';
  const prefix = opts.prefixArgs ?? [];
  return {
    async run(req) {
      const { prompt, cwd, limits, onOutput = undefined } = req;
      const tracking = Object.hasOwn(req, 'session');
      const resumeId = tracking && req.session ? req.session : undefined;
      const { code, stdout, stderr, timedOut, changedFiles } = await runProcessAgent({
        command,
        args: [...prefix, ...buildCodexArgs({ prompt, model: opts.model, resumeId })],
        cwd,
        env: opts.env,
        maxWallClockSeconds: limits.maxWallClockSeconds,
        onOutput,
      });
      const parsed = parseCodexOutput(stdout);
      const exitStatus = timedOut ? 124 : code;
      const transcript = stderr ? `${parsed.transcript}\n[stderr]\n${stderr}` : parsed.transcript;
      return { exitStatus, transcript, changedFiles, ...(tracking ? { session: parsed.threadId ?? resumeId } : {}) };
    },
  };
}
