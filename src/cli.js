import { helpText, usageText, parseStepArgs, readlineOptions, LOGO } from './cli-lib.js';
import { runBish } from './bish.js';
import { runBash } from './bash.js';
import { runBosh } from './bosh.js';
import { runBishBashBosh } from './bish-bash-bosh.js';

export { helpText, parseStepArgs, readlineOptions, LOGO };

const BISH_BASH_BOSH_COMMANDS = ['spec-lint', 'ready', 'promote', 'clean-room', 'proxy', 'control', 'console'];

// Thin router: decides which of bish/bash/bosh/bish-bash-bosh owns argv[0] and delegates. The gating
// below (which commands exist under which bin) must match exactly what each of bin/bish, bin/bash,
// bin/bosh and bin/bish-bash-bosh expose.
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

  if (BISH_BASH_BOSH_COMMANDS.includes(cmd)) return runBishBashBosh(cmd, argv, deps, out, err);

  const phase = deps.program !== 'bish-bash-bosh' && (cmd === 'bish' || cmd === 'bash' || cmd === 'bosh');
  if (!['status', 'tui'].includes(cmd) && !phase) {
    err(`bish-bash-bosh: unknown command '${argv[0]}'\n\n${usageText()}`);
    return 2;
  }

  if (cmd === 'bish') return runBish(argv, deps, out, err);
  if (cmd === 'status' || cmd === 'tui') return runBishBashBosh(cmd, argv, deps, out, err);
  if (cmd === 'bash') return runBash(cmd, argv, deps, out, err);
  return runBosh(cmd, argv, deps, out, err);
}
