import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateConfig } from './config.js';
import { resolveAdapter, defaultRegistry } from './adapters/index.js';
import { runStep } from './step.js';
import { runLoop } from './driver.js';
import { lintSpecs } from './spec-lint.js';

/** @returns {string} */
export function helpText() {
  return [
    'hodge: model-agnostic harness for loop-engineered delivery',
    '',
    'Usage:',
    '  hodge [--help]',
    '  hodge step --config <file> [--repo <dir>] [--run-id <id>]',
    '  hodge run  --config <file> [--repo <dir>] [--run-id <id>]',
    '  hodge spec-lint [--repo <dir>]',
    '',
    'Commands:',
    '  step   run one loop iteration; prints JSON {sha, iteration, cost, status}',
    '         (--repo defaults to ., --run-id defaults to "default")',
    '  run    loop steps until the plan is done or a step fails/gates/runs out of budget;',
    '         prints JSON {status, steps, reason?}; exit 0 only when done',
    '  spec-lint  check specs/*.md structure and tests/PLAN.md mapping; prints JSON {ok, problems};',
    '         exit 0 only when clean',
    '',
  ].join('\n');
}

/**
 * @param {string[]} args
 * @returns {{ok: true, config: string, repo: string, runId: string} | {ok: false, error: string}}
 */
export function parseStepArgs(args) {
  /** @type {Record<string, string | undefined>} */
  const v = { '--repo': '.', '--run-id': 'default' };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!['--config', '--repo', '--run-id'].includes(flag)) return { ok: false, error: `unknown argument '${flag}'` };
    const val = args[i + 1];
    if (val === undefined || val.startsWith('--')) return { ok: false, error: `${flag} requires a value` };
    v[flag] = val;
  }
  if (!v['--config']) return { ok: false, error: '--config <file> is required' };
  return { ok: true, config: v['--config'], repo: /** @type {string} */ (v['--repo']), runId: /** @type {string} */ (v['--run-id']) };
}

/**
 * @typedef {{
 *   registry?: import('./adapters/index.js').AdapterRegistry,
 *   testCommand?: string[],
 *   identity?: import('./repo-gate.js').HarnessIdentity,
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
  if (cmd !== 'step' && cmd !== 'run') {
    err(`hodge: unknown command '${argv[0]}'\n\n${helpText()}`);
    return 2;
  }

  const parsed = parseStepArgs(argv.slice(1));
  if (!parsed.ok) {
    err(`hodge ${cmd}: ${parsed.error}\n`);
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
  try {
    const adapter = resolveAdapter(config, 'build', deps.registry ?? defaultRegistry);
    const run = cmd === 'run' ? runLoop : runStep;
    const res = await run({
      config,
      repoDir: resolve(parsed.repo),
      runId: parsed.runId,
      adapter,
      testCommand: deps.testCommand,
      identity: deps.identity,
      requireTestPlan: /** @type {{requireTestPlan?: boolean}} */ (config).requireTestPlan === true,
    });
    out(`${JSON.stringify(res)}\n`);
    return res.status === 'ok' || res.status === 'done' ? 0 : 1;
  } catch (e) {
    err(`hodge ${cmd}: ${/** @type {Error} */ (e).message}\n`);
    return 2;
  }
}
