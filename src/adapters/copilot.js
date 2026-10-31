import { randomUUID } from 'node:crypto';
import { runProcessAgent } from './process.js';

// Arguments for a non-interactive Copilot CLI run. `sessionId` (set by the caller once it opts
// into session tracking, see createCopilotAdapter below) both starts and resumes a conversation:
// `--session-id` creates a new session the first time it is used, and continues it on every later
// call with the same id.
/** @param {{ prompt: string, model?: string, sessionId?: string }} args */
export function buildCopilotArgs({ prompt, model, sessionId }) {
  const args = ['-p', prompt, '--output-format', 'json', '--allow-all', '--no-ask-user'];
  if (model) args.push('--model', model);
  if (sessionId) args.push('--session-id', sessionId);
  return args;
}

// Parse JSONL output: join assistant messages. Non-JSON lines are kept in the transcript.
export function parseCopilotOutput(stdout) {
  const parts = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      parts.push(line);
      continue;
    }
    const d = ev?.data ?? {};
    if (ev?.type === 'assistant.message' && typeof d.content === 'string') parts.push(d.content);
  }
  return { transcript: parts.join('\n') };
}

// Wrap a live-output sink so JSONL events flagged `"ephemeral":true` (session.* and assistant.reasoning_delta: pure noise in debug logs) are dropped.
// Lines are buffered per stream; everything else passes through unchanged.
export function dropEphemeralEvents(sink) {
  if (!sink) return undefined;
  const buf = { stdout: '', stderr: '' };
  const noise = (line) => {
    if (!line.startsWith('{')) return false;
    try {
      return JSON.parse(line)?.ephemeral === true;
    } catch {
      return false;
    }
  };
  return {
    write(stream, chunk) {
      buf[stream] += chunk;
      const lines = buf[stream].split('\n');
      buf[stream] = lines.pop() ?? '';
      for (const l of lines) if (!noise(l)) sink(stream, `${l}\n`);
    },
    flush() {
      for (const stream of (['stdout', 'stderr'])) {
        if (buf[stream] && !noise(buf[stream])) sink(stream, buf[stream]);
        buf[stream] = '';
      }
    },
  };
}

// Wrap a plain-text callback so only `assistant.reasoning_delta` events' own text (just
// `data.deltaContent`, never the surrounding JSON) is forwarded to it, for a caller that wants a
// live "thinking" stream (e.g. the Interview Loop) without parsing JSONL itself. No-op (returns
// undefined) when `onReasoning` is omitted, same opt-in shape as `dropEphemeralEvents`.
export function createReasoningSink(onReasoning) {
  if (!onReasoning) return undefined;
  const buf = { stdout: '', stderr: '' };
  return {
    write(stream, chunk) {
      buf[stream] += chunk;
      const lines = buf[stream].split('\n');
      buf[stream] = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('{')) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev?.type === 'assistant.reasoning_delta' && typeof ev?.data?.deltaContent === 'string') {
          onReasoning(ev.data.deltaContent);
        }
      }
    },
    flush() {
      buf.stdout = '';
      buf.stderr = '';
    },
  };
}

// Adapter driving the Copilot CLI in non-interactive mode. Session tracking is opt-in: a caller
// that never passes `session` gets the old stateless behaviour unchanged (no `--session-id` flag
// at all). A caller that passes `session` (undefined on its first call, then whatever this run
// returned) gets a real, resumed Copilot CLI conversation across calls.
export function createCopilotAdapter(opts = {}) {
  const command = opts.command ?? 'copilot';
  const prefix = opts.prefixArgs ?? [];
  return {
    async run(req) {
      const { prompt, cwd, limits, onOutput = undefined, onReasoning = undefined } = req;
      const tracking = Object.hasOwn(req, 'session');
      const sessionId = tracking ? req.session || randomUUID() : undefined;
      const args = [...prefix, ...buildCopilotArgs({ prompt, model: opts.model, sessionId })];
      const live = dropEphemeralEvents(onOutput);
      const reasoning = createReasoningSink(onReasoning);
      const write = (!live && !reasoning) ? undefined : (stream, chunk) => {
        live?.write(stream, chunk);
        reasoning?.write(stream, chunk);
      };
      const { code, stdout, stderr, timedOut, changedFiles } = await runProcessAgent({
        command,
        args,
        cwd,
        env: opts.env,
        maxWallClockSeconds: limits.maxWallClockSeconds,
        onOutput: write,
      });
      live?.flush();
      reasoning?.flush();
      const parsed = parseCopilotOutput(stdout);
      const exitStatus = timedOut ? 124 : code;
      const transcript = stderr ? `${parsed.transcript}\n[stderr]\n${stderr}` : parsed.transcript;
      return { exitStatus, transcript, changedFiles, ...(tracking ? { session: sessionId } : {}) };
    },
  };
}
