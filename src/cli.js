import { helpText, usageText, parseStepArgs, readlineOptions, LOGO } from './cli-lib.js';
import { runHodge } from './hodge.js';
import { runGepo } from './gepo.js';
import { runPodge } from './podge.js';
import { runHodgepodge } from './hodgepodge.js';

export { helpText, parseStepArgs, readlineOptions, LOGO };

const HODGEPODGE_COMMANDS = ['spec-lint', 'ready', 'sync', 'promote', 'init', 'clean-room', 'proxy', 'kill', 'control', 'console'];

// Thin router: decides which of hodge/gepo/podge/hodgepodge owns argv[0] and delegates. The gating
// below (which commands exist under which bin) must match exactly what each of bin/hodge, bin/gepo,
// bin/podge and bin/hodgepodge expose.
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
  const cmd = argv[0];

  if (HODGEPODGE_COMMANDS.includes(cmd)) return runHodgepodge(cmd, argv, deps, out, err);

  const phase = deps.program !== 'hodgepodge' && (cmd === 'hodge' || cmd === 'gepo' || cmd === 'podge');
  if (!['status', 'tui'].includes(cmd) && !phase) {
    err(`hodgepodge: unknown command '${argv[0]}'\n\n${usageText()}`);
    return 2;
  }

  if (cmd === 'hodge') return runHodge(argv, deps, out, err);
  if (cmd === 'status' || cmd === 'tui') return runHodgepodge(cmd, argv, deps, out, err);
  if (cmd === 'gepo') return runGepo(cmd, argv, deps, out, err);
  return runPodge(cmd, argv, deps, out, err);
}
