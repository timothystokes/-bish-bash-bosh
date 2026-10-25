import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateConfig } from './config.js';
import { resolveAdapter, defaultRegistry } from './adapters/index.js';
import { runStep } from './step.js';
import { runLoop } from './driver.js';
import { lintSpecs } from './spec-lint.js';
import { runInterview } from './interview.js';
import { createLocalStatusSource, readRunStatus } from './status.js';
import { readControl, writeControl } from './control.js';
import { runTui } from './tui.js';

/** @returns {string} */
export function helpText() {
  return [
    'hodge: model-agnostic harness for loop-engineered delivery',
    '',
    'Usage:',
    '  hodge [--help]',
    '  hodge step --config <file> [--repo <dir>] [--run-id <id>]',
    '  hodge run  --config <file> [--repo <dir>] [--run-id <id>]',
    '  hodge interview --config <file> --objective <text> [--repo <dir>] [--run-id <id>]',
    '  hodge status --config <file> [--repo <dir>] [--run-id <id>] [--control <control.json>]',
    '  hodge tui --config <file> --control <control.json> [--repo <dir>] [--run-id <id>]',
    '  hodge spec-lint [--repo <dir>]',
    '  hodge control --file <control.json> pause|resume|stop|steer <note...>',
    '',
    'Commands:',
    '  step   run one loop iteration; prints JSON {sha, iteration, cost, status}',
    '         (--repo defaults to ., --run-id defaults to "default")',
    '  run    loop steps until the plan is done or a step fails/gates/runs out of budget (--control <file> honours control.json);',
    '         prints JSON {status, steps, reason?}; exit 0 only when done',
    '  interview  run the `interview` role to write specs/*.md + tests/PLAN.md; commits only if spec-lint passes;',
    '         prints JSON {status, sha, reason?}; exit 0 only when ok',
    '  status  print JSON run status: iterations, tokens, cost, seconds vs budgets (and control state with --control)',
    '  tui    live terminal view: log tail, cost meter vs budget; keys p pause, r resume, s steer, x stop (confirmed), q quit',
    '  spec-lint  check specs/*.md structure and tests/PLAN.md mapping; prints JSON {ok, problems};',
    '         exit 0 only when clean',
    '  control  write pause/resume/stop/steer to a control file read by `hodge run --control`; prints JSON {ok}',
    '',
  ].join('\n');
}

/**
 * @param {string[]} args
 * @param {{objective?: boolean, control?: boolean}} [opts] interview also takes (and requires) --objective; run takes --control
 * @returns {{ok: true, config: string, repo: string, runId: string, objective?: string, control?: string} | {ok: false, error: string}}
 */
export function parseStepArgs(args, opts = {}) {
  const flags = ['--config', '--repo', '--run-id', ...(opts.objective ? ['--objective'] : []), ...(opts.control ? ['--control'] : [])];
  /** @type {Record<string, string | undefined>} */
  const v = { '--repo': '.', '--run-id': 'default' };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!flags.includes(flag)) return { ok: false, error: `unknown argument '${flag}'` };
    const val = args[i + 1];
    if (val === undefined || val.startsWith('--')) return { ok: false, error: `${flag} requires a value` };
    v[flag] = val;
  }
  if (!v['--config']) return { ok: false, error: '--config <file> is required' };
  if (opts.objective && !v['--objective']) return { ok: false, error: '--objective <text> is required' };
  return {
    ok: true,
    config: v['--config'],
    repo: /** @type {string} */ (v['--repo']),
    runId: /** @type {string} */ (v['--run-id']),
    ...(opts.objective ? { objective: v['--objective'] } : {}),
    ...(v['--control'] ? { control: v['--control'] } : {}),
  };
}

/**
 * @typedef {{
 *   registry?: import('./adapters/index.js').AdapterRegistry,
 *   testCommand?: string[],
 *   identity?: import('./repo-gate.js').HarnessIdentity,
 *   input?: NodeJS.ReadableStream & {setRawMode?: (b: boolean) => unknown},
 *   stdout?: (s: string) => void,
 *   stderr?: (s: string) => void,
 * }} CliDeps
 */

/**
 * @param {string[]} argv
 * @param {CliDeps} [deps]
 * @returns {Promise<number>} exit code
 */
export async function main(argv, deps = {}) {
  const out = deps.stdout ?? ((/** @type {string} */ s) => process.stdout.write(s));
  const err = deps.stderr ?? ((/** @type {string} */ s) => process.stderr.write(s));
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    out(helpText());
    return 0;
  }
  const cmd = argv[0];
  if (cmd === 'spec-lint') {
    const rest = argv.slice(1);
    if (rest.length > 0 && (rest[0] !== '--repo' || rest.length !== 2 || rest[1].startsWith('--'))) {
      err(rest[0] === '--repo' ? 'hodge spec-lint: --repo requires a value\n' : `hodge spec-lint: unknown argument '${rest[0]}'\n`);
      return 2;
    }
    const res = lintSpecs(resolve(rest[1] ?? '.'));
    out(`${JSON.stringify(res)}\n`);
    return res.ok ? 0 : 1;
  }
  if (cmd === 'control') {
    const rest = argv.slice(1);
    if (rest[0] !== '--file' || !rest[1] || rest[1].startsWith('--')) {
      err('hodge control: --file <control.json> is required\n');
      return 2;
    }
    const [action, ...note] = rest.slice(2);
    /** @type {Record<string, {paused?: boolean, stop?: boolean, steer?: string}>} */
    const updates = { pause: { paused: true }, resume: { paused: false }, stop: { stop: true } };
    const text = note.join(' ').trim();
    const update = action === 'steer' ? (text ? { steer: text } : undefined) : updates[action ?? ''];
    if (!update || (action !== 'steer' && note.length > 0)) {
      err(`hodge control: expected pause, resume, stop, or steer <note>${action ? ` (got '${action}')` : ''}\n`);
      return 2;
    }
    const res = writeControl(resolve(rest[1]), update);
    out(`${JSON.stringify(res)}\n`);
    return res.ok ? 0 : 1;
  }
  if (cmd !== 'step' && cmd !== 'run' && cmd !== 'interview' && cmd !== 'status' && cmd !== 'tui') {
    err(`hodge: unknown command '${argv[0]}'\n\n${helpText()}`);
    return 2;
  }

  const parsed = parseStepArgs(argv.slice(1), { objective: cmd === 'interview', control: cmd === 'run' || cmd === 'status' || cmd === 'tui' });
  if (!parsed.ok) {
    err(`hodge ${cmd}: ${parsed.error}\n`);
    return 2;
  }
  if (cmd === 'tui' && !parsed.control) {
    err('hodge tui: --control <control.json> is required\n');
    return 2;
  }
  /** @type {unknown} */
  let config;
  try {
    config = JSON.parse(readFileSync(parsed.config, 'utf8'));
  } catch (e) {
    err(`hodge ${cmd}: cannot read config '${parsed.config}': ${/** @type {Error} */ (e).message}\n`);
    return 2;
  }
  const v = validateConfig(config);
  if (!v.ok) {
    err(`hodge ${cmd}: invalid config: ${v.errors.join('; ')}\n`);
    return 2;
  }
  if (cmd === 'tui') {
    await runTui({
      source: createLocalStatusSource(resolve(parsed.repo)),
      runId: parsed.runId,
      budgets: /** @type {any} */ (config).budgets,
      controlFile: resolve(/** @type {string} */ (parsed.control)),
      input: deps.input ?? process.stdin,
      output: { write: out },
    });
    return 0;
  }
  if (cmd === 'status') {
    const status = readRunStatus(createLocalStatusSource(resolve(parsed.repo)), parsed.runId, /** @type {any} */ (config).budgets);
    const control = parsed.control ? readControl(resolve(parsed.control)) : undefined;
    out(`${JSON.stringify(control ? { ...status, control } : status)}\n`);
    return 0;
  }
  try {
    const adapter = resolveAdapter(config, cmd === 'interview' ? 'interview' : 'build', deps.registry ?? defaultRegistry);
    if (cmd === 'interview') {
      const res = await runInterview({
        config,
        repoDir: resolve(parsed.repo),
        runId: parsed.runId,
        adapter,
        objective: parsed.objective ?? '',
        identity: deps.identity,
      });
      out(`${JSON.stringify(res)}\n`);
      return res.status === 'ok' ? 0 : 1;
    }
    const run = cmd === 'run' ? runLoop : runStep;
    const res = await run({
      config,
      repoDir: resolve(parsed.repo),
      runId: parsed.runId,
      adapter,
      testCommand: deps.testCommand,
      identity: deps.identity,
      ...(cmd === 'run' && parsed.control ? { controlFile: resolve(parsed.control) } : {}),
      requireTestPlan: /** @type {{requireTestPlan?: boolean}} */ (config).requireTestPlan === true,
    });
    out(`${JSON.stringify(res)}\n`);
    return res.status === 'ok' || res.status === 'done' ? 0 : 1;
  } catch (e) {
    err(`hodge ${cmd}: ${/** @type {Error} */ (e).message}\n`);
    return 2;
  }
}
