import { runProcessAgent } from './process.js';

// Arguments for a non-interactive Claude Code run.
export function buildClaudeArgs({ prompt, model }) {
  const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
  if (model) args.push('--model', model);
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

// Adapter driving Claude Code in non-interactive mode.
export function createClaudeCodeAdapter(opts = {}) {
  const command = opts.command ?? 'claude';
  const prefix = opts.prefixArgs ?? [];
  return {
    async run({ prompt, cwd, limits, onOutput = undefined }) {
      const { code, stdout, stderr, timedOut, changedFiles } = await runProcessAgent({
        command,
        args: [...prefix, ...buildClaudeArgs({ prompt, model: opts.model })],
        cwd,
        env: opts.env,
        maxWallClockSeconds: limits.maxWallClockSeconds,
        onOutput,
      });
      const parsed = parseClaudeOutput(stdout);
      const exitStatus = timedOut ? 124 : code;
      const transcript = stderr ? `${parsed.transcript}\n[stderr]\n${stderr}` : parsed.transcript;
      return { exitStatus, transcript, changedFiles };
    },
  };
}
