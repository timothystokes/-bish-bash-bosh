import { writeFileSync } from 'node:fs';
import { helpText, usageText, parseStepArgs, readlineOptions, LOGO, createTerminalFooter } from './cli-lib.js';
import { runBish } from '../bish/bish.js';
import { runBash } from '../bash/bash.js';
import { runBosh } from '../bosh/bosh.js';
import { loadProjectConfig } from '../shared/project-config.js';
import { effectiveSettings } from '../bish/prompts/interview-dials.js';
import { stringify as stringifyYaml } from 'yaml';

export { helpText, parseStepArgs, readlineOptions, LOGO };

// Thin router: decides which of bish/bash/bosh owns argv[0] and delegates.
export async function main(argv, deps = {}) {
  const writeOut = deps.stdout ?? ((s) => process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s) => process.stderr.write(s));
  let terminalFooter;
  const out = (s) => { writeOut(s); terminalFooter?.refresh(); };
  const err = (s) => { writeErr(s); terminalFooter?.refresh(); };
  // Human-facing chatter (like the interview's "Analyst thinking..." banner) goes to stderr so stdout stays pure
  // JSON (or pure help text for --help/no-args) for every command, per the CLI's stdout/stderr contract.
  err(`${LOGO}\n`);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    out(helpText());
    return 0;
  }
  const cmd = argv[0];
  if (!['bish', 'bash', 'bosh'].includes(cmd)) {
    err(`bish-bash-bosh: unknown command '${argv[0]}'\n\n${usageText()}`);
    return 2;
  }

  const input = deps.input ?? process.stdin;
  const terminalOutput = deps.terminalOutput ?? process.stdout;
  const canShowFooter = (!deps.stdout || deps.terminalOutput)
    && input.isTTY && terminalOutput.isTTY && terminalOutput.rows;
  const project = canShowFooter ? loadProjectConfig() : undefined;
  const config = project?.ok ? project.config : {};
  let settingsChanged = false;
  const dials = {
    get: () => effectiveSettings(config),
    getSettings: () => effectiveSettings(config),
    settingsChanged: () => settingsChanged,
    adjust: (name, delta) => {
      const current = effectiveSettings(config);
      config[name] = Math.min(10, Math.max(1, current[name] + delta));
      settingsChanged = true;
      if (project?.ok) writeFileSync(project.configPath, stringifyYaml(config));
    },
  };
  const mode = cmd === 'bish'
    ? (argv.includes('--reverse') ? 'Reverse' : 'Interview')
    : cmd === 'bash' ? 'Plan' : 'Build';
  terminalFooter = canShowFooter
    ? createTerminalFooter(input, terminalOutput, dials, { command: cmd, mode })
    : undefined;
  terminalFooter?.show();
  const commandDeps = terminalFooter ? { ...deps, terminalOutput, terminalFooter } : deps;
  try {
    if (cmd === 'bish') return await runBish(argv, commandDeps, out, err);
    if (cmd === 'bash') return await runBash(cmd, argv, commandDeps, out, err);
    return await runBosh(cmd, argv, commandDeps, out, err);
  } finally {
    terminalFooter?.remove();
  }
}
