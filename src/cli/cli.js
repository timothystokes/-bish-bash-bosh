import { helpText, usageText, parseStepArgs, readlineOptions, LOGO } from './cli-lib.js';
import { runBish } from '../bish/bish.js';
import { runBash } from '../bash/bash.js';
import { runBosh } from '../bosh/bosh.js';

export { helpText, parseStepArgs, readlineOptions, LOGO };

// Thin router: decides which of bish/bash/bosh owns argv[0] and delegates.
export async function main(argv, deps = {}) {
  const out = deps.stdout ?? ((s) => process.stdout.write(s));
  const err = deps.stderr ?? ((s) => process.stderr.write(s));
  // Human-facing chatter (like the interview's "Analyst thinking..." banner) goes to stderr so stdout stays pure
  // JSON (or pure help text for --help/no-args) for every command, per the CLI's stdout/stderr contract.
  err(`${LOGO}\n`);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    out(helpText());
    return 0;
  }
  const cmd = argv[0];

  if (cmd === 'bish') return runBish(argv, deps, out, err);
  if (cmd === 'bash') return runBash(cmd, argv, deps, out, err);
  if (cmd === 'bosh') return runBosh(cmd, argv, deps, out, err);
  err(`bish-bash-bosh: unknown command '${argv[0]}'\n\n${usageText()}`);
  return 2;
}
