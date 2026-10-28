import { runProcessAgent } from './process.js';

/**
 * @typedef {{model?: string, command?: string, prefixArgs?: string[], env?: Record<string, string>}} CopilotOptions
 */

/**
 * Arguments for a non-interactive Copilot CLI run.
 * @param {{prompt: string, model?: string}} p
 * @returns {string[]}
 */
export function buildCopilotArgs({ prompt, model }) {
  const args = ['-p', prompt, '--output-format', 'json', '--allow-all', '--no-ask-user'];
  if (model) args.push('--model', model);
  return args;
}

/**
 * Parse JSONL output: join assistant messages. Non-JSON lines are kept in the transcript.
 * @param {string} stdout
 * @returns {{transcript: string}}
 */
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

/**
 * Wrap a live-output sink so JSONL events flagged `"ephemeral":true` (session.* and assistant.reasoning_delta: pure noise in debug logs) are dropped.
 * Lines are buffered per stream; everything else passes through unchanged.
 * @param {((stream: 'stdout' | 'stderr', chunk: string) => void) | undefined} sink
 * @returns {{write: (stream: 'stdout' | 'stderr', chunk: string) => void, flush: () => void} | undefined}
 */
export function dropEphemeralEvents(sink) {
  if (!sink) return undefined;
  const buf = { stdout: '', stderr: '' };
  const noise = (/** @type {string} */ line) => {
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
      for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
        if (buf[stream] && !noise(buf[stream])) sink(stream, buf[stream]);
        buf[stream] = '';
      }
    },
  };
}

/**
 * Adapter driving the Copilot CLI in non-interactive mode.
 * @param {CopilotOptions} [opts]
 * @returns {import('../adapter.js').Adapter}
 */
export function createCopilotAdapter(opts = {}) {
  const command = opts.command ?? 'copilot';
  const prefix = opts.prefixArgs ?? [];
  return {
    async run({ prompt, cwd, limits, onOutput }) {
      const args = [...prefix, ...buildCopilotArgs({ prompt, model: opts.model })];
      const live = dropEphemeralEvents(onOutput);
      const { code, stdout, stderr, timedOut, changedFiles } = await runProcessAgent({
        command,
        args,
        cwd,
        env: opts.env,
        maxWallClockSeconds: limits.maxWallClockSeconds,
        onOutput: live?.write,
      });
      live?.flush();
      const parsed = parseCopilotOutput(stdout);
      const exitStatus = timedOut ? 124 : code;
      const transcript = stderr ? `${parsed.transcript}\n[stderr]\n${stderr}` : parsed.transcript;
      return { exitStatus, transcript, changedFiles };
    },
  };
}
