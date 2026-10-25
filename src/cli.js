import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateConfig } from './config.js';
import { resolveAdapter, defaultRegistry } from './adapters/index.js';
import { runStep } from './step.js';
import { runLoop } from './driver.js';
import { lintSpecs } from './spec-lint.js';
import { runInterview } from './interview.js';
import { runReverse } from './reverse.js';
import { initSandbox } from './init-sandbox.js';
import { exportBundle } from './clean-room.js';
import { createLocalStatusSource, readRunStatus } from './status.js';
import { readControl, writeControl } from './control.js';
import { runTui } from './tui.js';
import { stopContainer, dockerRunner } from './kill-switch.js';
import { createSecretProxy } from './secret-proxy.js';
import { syncArtifacts, requestPromotion } from './artifacts.js';
import { createAwsCliS3Client, createGhPrOpener, defaultRun } from './cloud-clients.js';

/** @returns {string} */
export function helpText() {
  return [
    'hodge: model-agnostic harness for loop-engineered delivery',
    '',
    'Usage:',
    '  hodge [--help]',
    '  Sandbox shortcut: after `hodge init --dir <sandbox>`, pass just --dir <sandbox> instead of --config and --repo (config <sandbox>/hodge.json, repo <sandbox>/target);',
    '  step/run/interview/reverse/status/tui/spec-lint/sync/promote all accept it; explicit --config/--repo override.',
    '  hodge step --config <file> [--repo <dir>] [--run-id <id>]',
    '  hodge run  --config <file> [--repo <dir>] [--run-id <id>]',
    '  hodge interview --config <file> --objective <text> [--repo <dir>] [--run-id <id>]',
    '  hodge reverse --config <file> [--repo <dir>] [--run-id <id>]',
    '  hodge clean-room --source <dir> --repo <builder-dir>',
    '  hodge status --config <file> [--repo <dir>] [--run-id <id>] [--control <control.json>]',
    '  hodge tui --config <file> --control <control.json> [--repo <dir>] [--run-id <id>]',
    '  hodge proxy --upstream <url> [--audit <file>] [--meter <file>] [--port <n>]',
    '  hodge sync --bucket <name> --run-id <id> [--repo <dir>]',
    '  hodge promote --run-id <id> --head <branch> --base <branch> --bucket <name> [--sha <sha>] [--repo <dir>]',
    '  hodge init --dir <sandbox> --adapter <id> --model <id> [--seed toy|empty]',
    '  hodge spec-lint [--repo <dir> | --dir <sandbox>]',
    '  hodge kill --container <name> [--control <control.json>] [--grace <sec>]',
    '  hodge control --file <control.json> pause|resume|stop|steer <note...>',
    '',
    'Commands:',
    '  step   run one loop iteration; prints JSON {sha, iteration, cost, status}',
    '         (--repo defaults to ., --run-id defaults to "default")',
    '  run    loop steps until the plan is done or a step fails/gates/runs out of budget (--control <file> honours control.json);',
    '         prints JSON {status, steps, reason?}; exit 0 only when done',
    '  interview  run the `interview` role to write specs/*.md + tests/PLAN.md; commits only if spec-lint passes;',
    '         prints JSON {status, sha, reason?}; exit 0 only when ok',
    '  reverse  run the `reverse` role to write specs/ + characterization tests from existing code; commits only if only specs/tests changed,',
    '         spec-lint passes and the test suite is green; prints JSON {status, sha, reason?}; exit 0 only when ok',
    '  init   scaffold a sandbox: <dir>/target (git repo seeded from templates) + <dir>/hodge.json (outside the repo); refuses dirs inside hodgepodge\n         or non-empty dirs; seed toy (default: spec, red tests, open plan) or empty; prints JSON {ok, dir, repo, config}; exit 0 only when ok',
    '  clean-room  export only specs/ + tests/ from --source into a fresh git repo at --repo (the builder never sees source); prints JSON {ok, sha, files};',
    '         exit 0 only when ok. Then run `hodge run` there with config mode clean-room (firewall gate checks the bundle first)',
    '  status  print JSON run status: iterations, tokens, cost, seconds vs budgets (and control state with --control)',
    '  tui    live terminal view: log tail, cost meter vs budget; keys p pause, r resume, s steer, x stop (confirmed), q quit',
    '  proxy  secret-redacting, usage-metering proxy in front of a model endpoint; prints JSON {port} then serves until SIGINT/SIGTERM',
    '  spec-lint  check specs/*.md structure and tests/PLAN.md mapping; prints JSON {ok, problems};',
    '         exit 0 only when clean',
    '  sync   copy runs/<id>/** to S3 (idempotent, needs the `aws` CLI); prints JSON {uploaded, skipped}',
    '  promote  open a promotion-review PR from --head to --base with the commit and artifacts URI (needs `gh`); never merges; prints JSON {url}',
    '  kill   stop the run container: sets stop in --control first (so no new iteration starts), then `docker stop`; prints JSON {stopped, name};\n         exit 0 when stopped or already gone, 1 on docker failure',
    '  control  write pause/resume/stop/steer to a control file read by `hodge run --control`; prints JSON {ok}',
    '',
  ].join('\n');
}

/**
 * @param {string[]} args
 * `--dir <sandbox>` (as scaffolded by `hodge init`) stands for --config <dir>/hodge.json and --repo <dir>/target; explicit flags win.
 * @param {{objective?: boolean, control?: boolean}} [opts] interview also takes (and requires) --objective; run takes --control
 * @returns {{ok: true, config: string, repo: string, runId: string, objective?: string, control?: string} | {ok: false, error: string}}
 */
export function parseStepArgs(args, opts = {}) {
  const flags = ['--dir', '--config', '--repo', '--run-id', ...(opts.objective ? ['--objective'] : []), ...(opts.control ? ['--control'] : [])];
  /** @type {Record<string, string | undefined>} */
  const v = { '--run-id': 'default' };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!flags.includes(flag)) return { ok: false, error: `unknown argument '${flag}'` };
    const val = args[i + 1];
    if (val === undefined || val.startsWith('--')) return { ok: false, error: `${flag} requires a value` };
    v[flag] = val;
  }
  const dir = v['--dir'];
  v['--config'] ??= dir ? join(dir, 'hodge.json') : undefined;
  v['--repo'] ??= dir ? join(dir, 'target') : '.';
  if (!v['--config']) return { ok: false, error: '--config <file> (or --dir <sandbox>) is required' };
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
 *   signal?: AbortSignal,
 *   input?: NodeJS.ReadableStream & {setRawMode?: (b: boolean) => unknown},
 *   stdout?: (s: string) => void,
 *   stderr?: (s: string) => void,
 *   exec?: import('./cloud-clients.js').Run,
 *   docker?: import('./kill-switch.js').DockerRunner,
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
    /** @type {Record<string, string | undefined>} */
    const v = {};
    for (let i = 0; i < rest.length; i += 2) {
      const val = rest[i + 1];
      if (!['--repo', '--dir'].includes(rest[i])) {
        err(`hodge spec-lint: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodge spec-lint: ${rest[i]} requires a value\n`);
        return 2;
      }
      v[rest[i]] = val;
    }
    const res = lintSpecs(resolve(v['--repo'] ?? (v['--dir'] ? join(v['--dir'], 'target') : '.')));
    out(`${JSON.stringify(res)}\n`);
    return res.ok ? 0 : 1;
  }
  if (cmd === 'sync' || cmd === 'promote') {
    const rest = argv.slice(1);
    const allowed = cmd === 'sync' ? ['--bucket', '--run-id', '--repo', '--dir'] : ['--bucket', '--run-id', '--head', '--base', '--sha', '--repo', '--dir'];
    const required = cmd === 'sync' ? ['--bucket', '--run-id'] : ['--bucket', '--run-id', '--head', '--base'];
    /** @type {Record<string, string | undefined>} */
    const v = {};
    for (let i = 0; i < rest.length; i += 2) {
      const val = rest[i + 1];
      if (!allowed.includes(rest[i])) {
        err(`hodge ${cmd}: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodge ${cmd}: ${rest[i]} requires a value\n`);
        return 2;
      }
      v[rest[i]] = val;
    }
    const missing = required.filter((f) => !v[f]);
    if (missing.length > 0) {
      err(`hodge ${cmd}: ${missing.join(', ')} required\n`);
      return 2;
    }
    const run = deps.exec ?? defaultRun;
    const repoDir = resolve(v['--repo'] ?? (v['--dir'] ? join(v['--dir'], 'target') : '.'));
    try {
      if (cmd === 'sync') {
        const res = await syncArtifacts({ client: createAwsCliS3Client({ run }), bucket: v['--bucket'] ?? '', repoDir, runId: v['--run-id'] ?? '' });
        out(`${JSON.stringify(res)}\n`);
        return 0;
      }
      let sha = v['--sha'];
      if (!sha) {
        const r = await run('git', ['-C', repoDir, 'rev-parse', v['--head'] ?? ''], { cwd: repoDir });
        if (r.code !== 0) throw new Error(`git rev-parse failed: ${r.stderr.trim()}`);
        sha = r.stdout.trim();
      }
      const res = await requestPromotion({
        opener: createGhPrOpener({ run, cwd: repoDir }),
        runId: v['--run-id'] ?? '',
        head: v['--head'] ?? '',
        base: v['--base'] ?? '',
        artifactsUri: `s3://${v['--bucket']}/runs/${v['--run-id']}/`,
        sha,
      });
      out(`${JSON.stringify(res)}\n`);
      return 0;
    } catch (e) {
      err(`hodge ${cmd}: ${/** @type {Error} */ (e).message}\n`);
      return 2;
    }
  }
  if (cmd === 'init') {
    const rest = argv.slice(1);
    /** @type {Record<string, string | undefined>} */
    const v = {};
    for (let i = 0; i < rest.length; i += 2) {
      const val = rest[i + 1];
      if (!['--dir', '--adapter', '--model', '--seed'].includes(rest[i])) {
        err(`hodge init: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodge init: ${rest[i]} requires a value\n`);
        return 2;
      }
      v[rest[i]] = val;
    }
    if (!v['--dir'] || !v['--adapter'] || !v['--model']) {
      err('hodge init: --dir, --adapter and --model are required\n');
      return 2;
    }
    const res = initSandbox({ dir: v['--dir'], adapter: v['--adapter'], model: v['--model'], seed: v['--seed'] });
    out(`${JSON.stringify(res)}\n`);
    return res.ok ? 0 : 1;
  }
  if (cmd === 'clean-room') {
    const rest = argv.slice(1);
    /** @type {Record<string, string | undefined>} */
    const v = {};
    for (let i = 0; i < rest.length; i += 2) {
      const val = rest[i + 1];
      if (!['--source', '--repo'].includes(rest[i])) {
        err(`hodge clean-room: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodge clean-room: ${rest[i]} requires a value\n`);
        return 2;
      }
      v[rest[i]] = val;
    }
    if (!v['--source'] || !v['--repo']) {
      err('hodge clean-room: --source and --repo are required\n');
      return 2;
    }
    const res = exportBundle({ sourceDir: v['--source'], builderDir: v['--repo'] });
    out(`${JSON.stringify(res)}\n`);
    return res.ok ? 0 : 1;
  }
  if (cmd === 'proxy') {
    const rest = argv.slice(1);
    /** @type {Record<string, string | undefined>} */
    const v = {};
    for (let i = 0; i < rest.length; i += 2) {
      const val = rest[i + 1];
      if (!['--upstream', '--audit', '--meter', '--port'].includes(rest[i])) {
        err(`hodge proxy: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodge proxy: ${rest[i]} requires a value\n`);
        return 2;
      }
      v[rest[i]] = val;
    }
    if (!v['--upstream']) {
      err('hodge proxy: --upstream <url> is required\n');
      return 2;
    }
    if (!URL.canParse(v['--upstream'])) {
      err(`hodge proxy: invalid --upstream '${v['--upstream']}'\n`);
      return 2;
    }
    const port = v['--port'] === undefined ? 0 : Number(v['--port']);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      err(`hodge proxy: invalid --port '${v['--port']}'\n`);
      return 2;
    }
    const proxy = createSecretProxy({
      upstream: v['--upstream'],
      ...(v['--audit'] ? { auditFile: resolve(v['--audit']) } : {}),
      ...(v['--meter'] ? { meterFile: resolve(v['--meter']) } : {}),
    });
    const stopped = new Promise((r) => {
      const stop = () => r(undefined);
      if (deps.signal) deps.signal.aborted ? stop() : deps.signal.addEventListener('abort', stop, { once: true });
      else {
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      }
    });
    try {
      out(`${JSON.stringify({ port: await proxy.listen(port) })}\n`);
    } catch (e) {
      err(`hodge proxy: ${/** @type {Error} */ (e).message}\n`);
      return 2;
    }
    await stopped;
    await proxy.close();
    return 0;
  }
  if (cmd === 'kill') {
    const rest = argv.slice(1);
    /** @type {Record<string, string | undefined>} */
    const v = {};
    for (let i = 0; i < rest.length; i += 2) {
      const val = rest[i + 1];
      if (!['--container', '--control', '--grace'].includes(rest[i])) {
        err(`hodge kill: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodge kill: ${rest[i]} requires a value\n`);
        return 2;
      }
      v[rest[i]] = val;
    }
    const name = v['--container'];
    if (!name || name.startsWith('-')) {
      err('hodge kill: --container <name> is required (a name, not an option)\n');
      return 2;
    }
    if (v['--grace'] !== undefined && !/^\d+$/.test(v['--grace'])) {
      err('hodge kill: --grace must be a whole number of seconds\n');
      return 2;
    }
    try {
      const res = await stopContainer({
        docker: deps.docker ?? dockerRunner(),
        name,
        ...(v['--control'] ? { controlFile: resolve(v['--control']) } : {}),
        ...(v['--grace'] !== undefined ? { graceSec: Number(v['--grace']) } : {}),
      });
      out(`${JSON.stringify(res)}\n`);
      return 0;
    } catch (e) {
      err(`hodge kill: ${/** @type {Error} */ (e).message}\n`);
      return 1;
    }
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
  if (cmd !== 'step' && cmd !== 'run' && cmd !== 'interview' && cmd !== 'reverse' && cmd !== 'status' && cmd !== 'tui') {
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
    const adapter = resolveAdapter(config, cmd === 'interview' || cmd === 'reverse' ? cmd : 'build', deps.registry ?? defaultRegistry);
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
    if (cmd === 'reverse') {
      const res = await runReverse({
        config,
        repoDir: resolve(parsed.repo),
        runId: parsed.runId,
        adapter,
        testCommand: deps.testCommand,
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
