import { helpText, usageText, parseStepArgs, readlineOptions, LOGO } from './cli-lib.js';
import { runHodge } from './hodge.js';
import { runPodge } from './podge.js';
import { runHodgepodge } from './hodgepodge.js';

export { helpText, parseStepArgs, readlineOptions, LOGO };

const HODGEPODGE_COMMANDS = ['spec-lint', 'ready', 'sync', 'promote', 'init', 'clean-room', 'proxy', 'kill', 'control', 'console'];

// Thin router: decides which of hodge/podge/hodgepodge owns argv[0] and delegates. The gating below
// (which commands exist under which bin, the `podge step` -> `step` rewrite) must match exactly what
// each of bin/hodge, bin/podge and bin/hodgepodge expose.
export async function main(argv, deps = {}) {
  const out = deps.stdout ?? ((s) => process.stdout.write(s));
  const err = deps.stderr ?? ((s) => process.stderr.write(s));
  // Human-facing chatter (like the interview's "Thinking..." banner) goes to stderr so stdout stays pure
  // JSON (or pure help text for --help/no-args) for every command, per the CLI's stdout/stderr contract.
  err(`${LOGO}\n`);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    out(helpText());
    return 0;
  }
  // `podge step` is the only way to run a single iteration; there is no top-level `step`.
  const viaPodge = deps.program !== 'hodgepodge' && argv[0] === 'podge' && argv[1] === 'step';
  if (viaPodge) argv = ['step', ...argv.slice(2)];
  const cmd = argv[0];

  if (HODGEPODGE_COMMANDS.includes(cmd)) return runHodgepodge(cmd, argv, deps, out, err);

  const phase = deps.program !== 'hodgepodge' && (cmd === 'hodge' || cmd === 'podge');
  if (!['status', 'tui'].includes(cmd) && !phase && !(cmd === 'step' && viaPodge)) {
    err(`hodgepodge: unknown command '${argv[0]}'\n\n${usageText()}`);
    return 2;
  }

  if (cmd === 'hodge') return runHodge(argv, deps, out, err);
  if (cmd === 'status' || cmd === 'tui') return runHodgepodge(cmd, argv, deps, out, err);
  return runPodge(cmd, argv, deps, out, err);
}
