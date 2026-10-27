import { runProcessAgent } from './process.js';

/**
 * @typedef {{model?: string, command?: string, prefixArgs?: string[], env?: Record<string, string>}} ClaudeCodeOptions
 */

/**
 * Arguments for a non-interactive Claude Code run.
 * @param {{prompt: string, model?: string}} p
 * @returns {string[]}
 */
export function buildClaudeArgs({ prompt, model }) {
  const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
  if (model) args.push('--model', model);
  return args;
}

/**
 * Parse `--output-format json` output: a result object (or an array containing one).
 * Cache tokens are excluded from the token count. Unparseable output becomes the transcript.
 * @param {string} stdout
 * @returns {{transcript: string, usage: import('../adapter.js').Usage}}
 */
export function parseClaudeOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { transcript: stdout.trim(), usage: { tokens: 0, cost: 0 } };
  }
  const ev = Array.isArray(parsed) ? [...parsed].reverse().find((/** @type {any} */ e) => e?.type === 'result') : parsed;
  if (!ev || typeof ev !== 'object') return { transcript: stdout.trim(), usage: { tokens: 0, cost: 0 } };
  const pos = (/** @type {unknown} */ n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
  return {
    transcript: typeof ev.result === 'string' ? ev.result : '',
    usage: { tokens: pos(ev.usage?.input_tokens) + pos(ev.usage?.output_tokens), cost: pos(ev.total_cost_usd) },
  };
}

/**
 * Adapter driving Claude Code in non-interactive mode.
 * @param {ClaudeCodeOptions} [opts]
 * @returns {import('../adapter.js').Adapter}
 */
export function createClaudeCodeAdapter(opts = {}) {
  const command = opts.command ?? 'claude';
  const prefix = opts.prefixArgs ?? [];
  return {
    async run({ prompt, cwd, limits, onOutput }) {
      const { code, stdout, stderr, timedOut, changedFiles } = await runProcessAgent({
        command,
        args: [...prefix, ...buildClaudeArgs({ prompt, model: opts.model })],
        cwd,
        env: opts.env,
        maxWallClockSeconds: limits.maxWallClockSeconds,
        onOutput,
      });
      const parsed = parseClaudeOutput(stdout);
      const over =
        (limits.maxTokens !== undefined && parsed.usage.tokens > limits.maxTokens) ||
        (limits.maxCostUsd !== undefined && parsed.usage.cost > limits.maxCostUsd);
      const exitStatus = timedOut ? 124 : code !== 0 ? code : over ? 1 : 0;
      const transcript = stderr ? `${parsed.transcript}\n[stderr]\n${stderr}` : parsed.transcript;
      return { exitStatus, transcript, usage: parsed.usage, changedFiles };
    },
  };
}
