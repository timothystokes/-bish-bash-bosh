import { writeFileSync } from 'node:fs';
import { helpText, usageText, parseStepArgs, readlineOptions, LOGO, createTerminalFooter } from './cli-lib.js';
import { runBish } from '../bish/bish.js';
import { runBash } from '../bash/bash.js';
import { runBosh } from '../bosh/bosh.js';
import { loadProjectConfig } from '../shared/project-config.js';
import { ADAPTER_CHOICES, MODEL_CHOICES, listModels } from '../shared/init.js';
import { effectiveSettings, retriesOf } from '../bish/prompts/interview-dials.js';
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
  // Copilot's live model list is fetched once in the background; until it arrives the static list is used.
  let copilotModels;
  if (canShowFooter && !deps.registry) {
    listModels('copilot').then((list) => { copilotModels = list.map((m) => m.value ?? m); }, () => {});
  }
  const modelChoices = (adapter) => (adapter === 'copilot' ? copilotModels : undefined) ?? MODEL_CHOICES[adapter] ?? [];
  const cycle = (choices, current, delta) => {
    const list = choices.includes(current) ? choices : [current, ...choices];
    return list[(list.indexOf(current) + delta + list.length) % list.length];
  };
  const dials = {
    get: () => ({ ...effectiveSettings(config), retries: retriesOf(config), agent: config.adapter, model: config.model }),
    getSettings: () => effectiveSettings(config),
    settingsChanged: () => settingsChanged,
    adjust: (name, delta) => {
      // Edit the file's current content so fields other phases wrote meanwhile (e.g. bishSession) are kept.
      const fresh = project?.ok ? loadProjectConfig() : undefined;
      const target = fresh?.ok ? fresh.config : config;
      if (name === 'agent') {
        target.adapter = cycle(ADAPTER_CHOICES, target.adapter, delta);
        const models = modelChoices(target.adapter);
        if (models.length && !models.includes(target.model)) target.model = models[0];
      } else if (name === 'model') {
        target.model = cycle(modelChoices(target.adapter), target.model, delta);
      } else if (name === 'retries') {
        target.retries = Math.min(10, Math.max(1, retriesOf(target) + delta));
      } else {
        target[name] = Math.min(10, Math.max(1, effectiveSettings(target)[name] + delta));
        settingsChanged = true;
      }
      Object.assign(config, target);
      if (project?.ok) writeFileSync(project.configPath, stringifyYaml(target));
    },
  };
  terminalFooter = canShowFooter
    ? createTerminalFooter(input, terminalOutput, dials, { command: cmd })
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
