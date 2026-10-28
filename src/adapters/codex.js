import { runProcessAgent } from './process.js';

/**
 * @typedef {{model?: string, command?: string, prefixArgs?: string[], env?: Record<string, string>}} CodexOptions
 */

/**
 * Arguments for a non-interactive Codex run (`codex exec`, JSONL events on stdout).
 * @param {{prompt: string, model?: string}} p
 * @returns {string[]}
 */
export function buildCodexArgs({ prompt, model }) {
  const args = ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox'];
  if (model) args.push('--model', model);
  args.push(prompt);
  return args;
}

/**
 * Parse `codex exec --json` JSONL: agent_message items form the transcript.
 * Non-JSON lines are ignored; output with no events becomes the transcript.
 * @param {string} stdout
 * @returns {{transcript: string}}
 */
export function parseCodexOutput(stdout) {
  const messages = [];
  let events = 0;
  for (const line of stdout.split('\n')) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') continue;
    events++;
    if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && typeof ev.item.text === 'string') messages.push(ev.item.text);
  }
  if (events === 0) return { transcript: stdout.trim() };
  return { transcript: messages.join('\n') };
}

/**
 * Adapter driving Codex in non-interactive mode.
 * @param {CodexOptions} [opts]
 * @returns {import('../adapter.js').Adapter}
 */
export function createCodexAdapter(opts = {}) {
  const command = opts.command ?? 'codex';
  const prefix = opts.prefixArgs ?? [];
  return {
    async run({ prompt, cwd, limits, onOutput }) {
      const { code, stdout, stderr, timedOut, changedFiles } = await runProcessAgent({
        command,
        args: [...prefix, ...buildCodexArgs({ prompt, model: opts.model })],
        cwd,
        env: opts.env,
        maxWallClockSeconds: limits.maxWallClockSeconds,
        onOutput,
      });
      const parsed = parseCodexOutput(stdout);
      const exitStatus = timedOut ? 124 : code;
      const transcript = stderr ? `${parsed.transcript}\n[stderr]\n${stderr}` : parsed.transcript;
      return { exitStatus, transcript, changedFiles };
    },
  };
}
