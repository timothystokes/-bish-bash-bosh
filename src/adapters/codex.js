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
 * Parse `codex exec --json` JSONL: agent_message items form the transcript and
 * `turn.completed` usage is summed (cached input excluded). USD cost is read from an optional `usage.cost_usd` (Codex does not report one today, so it is usually 0).
 * Non-JSON lines are ignored; output with no events becomes the transcript.
 * @param {string} stdout
 * @returns {{transcript: string, usage: import('../adapter.js').Usage}}
 */
export function parseCodexOutput(stdout) {
  const pos = (/** @type {unknown} */ n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
  const messages = [];
  let tokens = 0;
  let cost = 0;
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
    else if (ev.type === 'turn.completed') {
      tokens += pos(ev.usage?.input_tokens) + pos(ev.usage?.output_tokens);
      cost += pos(ev.usage?.cost_usd);
    }
  }
  if (events === 0) return { transcript: stdout.trim(), usage: { tokens: 0, cost: 0 } };
  return { transcript: messages.join('\n'), usage: { tokens, cost } };
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
    async run({ prompt, cwd, limits }) {
      const { code, stdout, stderr, timedOut, changedFiles } = await runProcessAgent({
        command,
        args: [...prefix, ...buildCodexArgs({ prompt, model: opts.model })],
        cwd,
        env: opts.env,
        maxWallClockSeconds: limits.maxWallClockSeconds,
      });
      const parsed = parseCodexOutput(stdout);
      const over =
        (limits.maxTokens !== undefined && parsed.usage.tokens > limits.maxTokens) ||
        (limits.maxCostUsd !== undefined && parsed.usage.cost > limits.maxCostUsd);
      const exitStatus = timedOut ? 124 : code !== 0 ? code : over ? 1 : 0;
      const transcript = stderr ? `${parsed.transcript}\n[stderr]\n${stderr}` : parsed.transcript;
      return { exitStatus, transcript, usage: parsed.usage, changedFiles };
    },
  };
}
