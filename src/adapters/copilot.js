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
 * Parse JSONL output: join assistant messages, sum usage events. Non-JSON lines are kept in the transcript.
 * @param {string} stdout
 * @returns {{transcript: string, usage: import('../adapter.js').Usage}}
 */
export function parseCopilotOutput(stdout) {
  const parts = [];
  let tokens = 0;
  let cost = 0;
  /** Live CLI output carries cumulative usage in session.usage_checkpoint; the last one wins. */
  let checkpointTokens = 0;
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
    if (ev?.type === 'assistant.usage') {
      for (const k of ['inputTokens', 'outputTokens']) if (Number.isFinite(d[k]) && d[k] > 0) tokens += d[k];
      if (Number.isFinite(d.cost) && d.cost > 0) cost += d.cost;
    }
    if (ev?.type === 'session.usage_checkpoint') {
      const metrics = Object.values(d.accountingSnapshot?.modelMetrics ?? {});
      let t = 0;
      for (const m of metrics) {
        const u = /** @type {any} */ (m)?.usage ?? {};
        for (const k of ['inputTokens', 'outputTokens']) if (Number.isFinite(u[k]) && u[k] > 0) t += u[k];
      }
      checkpointTokens = t;
    }
  }
  return { transcript: parts.join('\n'), usage: { tokens: tokens + checkpointTokens, cost } };
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
      const { code, stdout, stderr, timedOut, changedFiles } = await runProcessAgent({
        command,
        args,
        cwd,
        env: opts.env,
        maxWallClockSeconds: limits.maxWallClockSeconds,
        onOutput,
      });
      const parsed = parseCopilotOutput(stdout);
      const over =
        (limits.maxTokens !== undefined && parsed.usage.tokens > limits.maxTokens) ||
        (limits.maxCostUsd !== undefined && parsed.usage.cost > limits.maxCostUsd);
      const exitStatus = timedOut ? 124 : code !== 0 ? code : over ? 1 : 0;
      const transcript = stderr ? `${parsed.transcript}\n[stderr]\n${stderr}` : parsed.transcript;
      return { exitStatus, transcript, usage: parsed.usage, changedFiles };
    },
  };
}
