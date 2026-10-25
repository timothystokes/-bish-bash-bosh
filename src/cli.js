import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadSandbox, CONFIG_FILE } from './sandbox.js';
import { resolveAdapter, defaultRegistry } from './adapters/index.js';
import { runStep } from './step.js';
import { runLoop } from './driver.js';
import { lintSpecs } from './spec-lint.js';
import { checkReadiness, hasObjectiveKit } from './readiness.js';
import { createInterface } from 'node:readline';
import { runInterview } from './interview.js';
import { runObjective } from './objective.js';
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
    '  Sandbox commands take --dir <sandbox> (default: the current directory). `hodge init` writes <sandbox>/hodge.json holding the target repo,',
    '  roles, budgets and the path back to hodgepodge, so after `cd <sandbox>` just run `hodge run`, `hodge step`, `hodge interview`, ... (or ./hodge).',
    '  hodge step [--dir <sandbox>] [--run-id <id>]',
    '  hodge run  [--dir <sandbox>] [--run-id <id>] [--control <control.json>]',
    '  hodge objective [--dir <sandbox>] [--run-id <id>]',
    '  hodge interview [--dir <sandbox>] [--run-id <id>]',
    '  hodge reverse [--dir <sandbox>] [--run-id <id>]',
    '  hodge clean-room --source <dir> --repo <builder-dir>',
    '  hodge status [--dir <sandbox>] [--run-id <id>] [--control <control.json>]',
    '  hodge tui --control <control.json> [--dir <sandbox>] [--run-id <id>]',
    '  hodge proxy --upstream <url> [--audit <file>] [--meter <file>] [--port <n>]',
    '  hodge sync --bucket <name> --run-id <id> [--repo <dir> | --dir <sandbox>]',
    '  hodge promote --run-id <id> --head <branch> --base <branch> --bucket <name> [--sha <sha>] [--repo <dir> | --dir <sandbox>]',
    '  hodge init --dir <sandbox> --adapter <id> --model <id> [--seed toy|empty|objective]',
    '  hodge spec-lint [--repo <dir> | --dir <sandbox>]',
    '  hodge ready [--repo <dir> | --dir <sandbox>]',
    '  hodge kill --container <name> [--control <control.json>] [--grace <sec>]',
    '  hodge control --file <control.json> pause|resume|stop|steer <note...>',
    '',
    'Commands:',
    '  step   run one loop iteration; prints JSON {sha, iteration, cost, status}',
    '         (--dir defaults to ., --run-id defaults to "default")',
    '  run    loop steps until the plan is done or a step fails/gates/runs out of budget (--control <file> honours control.json);',
    '         prints JSON {status, steps, reason?}; exit 0 only when done',
    '  objective  requirements gathering: asks for a description of the objective, then alternates agent rounds with your answers (broad first,',
    '         then fine-grained) until `hodge ready` passes; needs a sandbox from `hodge init --seed objective`; Ctrl-D or an empty answer pauses and a',
    '         rerun resumes; prints JSON {status, rounds, reason?}; exit 0 only when ready',
    '  interview  asks for the objective (it is not a flag), then runs the `interview` role to write specs/*.md + tests/PLAN.md; commits only if spec-lint passes;',
    '         with an objective kit it is the same conversation as `hodge objective` (rounds until `hodge ready`); prints JSON {status, ...}; exit 0 only when ok',
    '  reverse  run the `reverse` role to write specs/ + characterization tests from existing code; commits only if only specs/tests changed,',
    '         spec-lint passes and the test suite is green; prints JSON {status, sha, reason?}; exit 0 only when ok',
    '  init   scaffold a sandbox: <dir>/target (git repo seeded from templates) + <dir>/hodge.json (outside the repo; holds the target repo and a reference back to hodgepodge) + <dir>/hodge launcher; refuses dirs inside hodgepodge\n         or non-empty dirs; seed toy (default: spec, red tests, open plan), empty, or objective (objective/ kit: phases, interview protocol, readiness signals, brief and open questions to be filled by `hodge objective`); every seed configures build, interview and reverse roles; prints JSON {ok, dir, repo, config, hodgepodge}; exit 0 only when ok',
    '  clean-room  export only specs/ + tests/ from --source into a fresh git repo at --repo (the builder never sees source); prints JSON {ok, sha, files};',
    '         exit 0 only when ok. Then run `hodge run` there with config mode clean-room (firewall gate checks the bundle first)',
    '  status  print JSON run status: iterations, tokens, cost, seconds vs budgets (and control state with --control)',
    '  tui    live terminal view: log tail, cost meter vs budget; keys p pause, r resume, s steer, x stop (confirmed), q quit',
    '  proxy  secret-redacting, usage-metering proxy in front of a model endpoint; prints JSON {port} then serves until SIGINT/SIGTERM',
    '  ready  check the specs are captured at a fine grain (granularity, testable/atomic requirements, examples, negative paths, no placeholders,\n         no open questions); prints JSON {ready, gaps}; exit 0 only when ready. `hodge run` is gated by it when the target has an objective kit',
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
 * Sandbox commands take only --dir (default: the current directory): the config, target repo and roles live in `<dir>/hodge.json`.
 * @param {string[]} args
 * @param {{control?: boolean}} [opts] run/status/tui also take --control
 * @returns {{ok: true, dir: string, runId: string, control?: string} | {ok: false, error: string}}
 */
export function parseStepArgs(args, opts = {}) {
  const flags = ['--dir', '--run-id', ...(opts.control ? ['--control'] : [])];
  /** @type {Record<string, string | undefined>} */
  const v = { '--run-id': 'default', '--dir': '.' };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!flags.includes(flag)) return { ok: false, error: `unknown argument '${flag}'` };
    const val = args[i + 1];
    if (val === undefined || val.startsWith('--')) return { ok: false, error: `${flag} requires a value` };
    v[flag] = val;
  }
  return {
    ok: true,
    dir: /** @type {string} */ (v['--dir']),
    runId: /** @type {string} */ (v['--run-id']),
    ...(v['--control'] ? { control: v['--control'] } : {}),
  };
}

/**
 * The repo a repo-level command works on: an explicit --repo, else the target of the sandbox in --dir (or in the current
 * directory when it holds a hodge.json), else the current directory.
 * @param {string | undefined} repo
 * @param {string | undefined} dir
 * @returns {string}
 */
function repoFor(repo, dir) {
  if (repo) return resolve(repo);
  const root = dir ?? '.';
  if (dir || existsSync(join(root, CONFIG_FILE))) {
    const sb = loadSandbox(root);
    return sb.ok ? sb.repo : resolve(join(root, 'target'));
  }
  return resolve('.');
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
    const res = lintSpecs(repoFor(v['--repo'], v['--dir']));
    out(`${JSON.stringify(res)}\n`);
    return res.ok ? 0 : 1;
  }
  if (cmd === 'ready') {
    const rest = argv.slice(1);
    /** @type {Record<string, string | undefined>} */
    const v = {};
    for (let i = 0; i < rest.length; i += 2) {
      const val = rest[i + 1];
      if (!['--repo', '--dir'].includes(rest[i])) {
        err(`hodge ready: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodge ready: ${rest[i]} requires a value\n`);
        return 2;
      }
      v[rest[i]] = val;
    }
    const res = checkReadiness(repoFor(v['--repo'], v['--dir']));
    out(`${JSON.stringify(res)}\n`);
    return res.ready ? 0 : 1;
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
    const repoDir = repoFor(v['--repo'], v['--dir']);
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
  if (cmd !== 'step' && cmd !== 'run' && cmd !== 'interview' && cmd !== 'objective' && cmd !== 'reverse' && cmd !== 'status' && cmd !== 'tui') {
    err(`hodge: unknown command '${argv[0]}'\n\n${helpText()}`);
    return 2;
  }

  const parsed = parseStepArgs(argv.slice(1), { control: cmd === 'run' || cmd === 'status' || cmd === 'tui' });
  if (!parsed.ok) {
    err(`hodge ${cmd}: ${parsed.error}\n`);
    return 2;
  }
  if (cmd === 'tui' && !parsed.control) {
    err('hodge tui: --control <control.json> is required\n');
    return 2;
  }
  const sandbox = loadSandbox(parsed.dir);
  if (!sandbox.ok) {
    err(`hodge ${cmd}: ${sandbox.error}\n`);
    return 2;
  }
  const { config, repo } = sandbox;
  if (cmd === 'tui') {
    await runTui({
      source: createLocalStatusSource(repo),
      runId: parsed.runId,
      budgets: config.budgets,
      controlFile: resolve(/** @type {string} */ (parsed.control)),
      input: deps.input ?? process.stdin,
      output: { write: out },
    });
    return 0;
  }
  if (cmd === 'status') {
    const status = readRunStatus(createLocalStatusSource(repo), parsed.runId, config.budgets);
    const control = parsed.control ? readControl(resolve(parsed.control)) : undefined;
    out(`${JSON.stringify(control ? { ...status, control } : status)}\n`);
    return 0;
  }
  try {
    const adapter = resolveAdapter(config, cmd === 'interview' || cmd === 'objective' || cmd === 'reverse' ? (cmd === 'objective' ? 'interview' : cmd) : 'build', deps.registry ?? defaultRegistry);
    if (cmd === 'objective' || cmd === 'interview') {
      const rl = createInterface({ input: deps.input ?? process.stdin });
      const lines = rl[Symbol.asyncIterator]();
      /** @type {(prompt: string) => Promise<string | null>} */
      const ask = async (prompt) => {
        out(prompt);
        const next = await lines.next();
        return next.done ? null : next.value;
      };
      try {
        // The objective is never a flag: it is captured here, as the first answer of the interview.
        if (cmd === 'interview' && !hasObjectiveKit(repo)) {
          const objective = ((await ask('Describe the objective in a sentence or two: what should exist when this is done, and why?\n> ')) ?? '').trim();
          const res = await runInterview({ config, repoDir: repo, runId: parsed.runId, adapter, objective, identity: deps.identity });
          out(`${JSON.stringify(res)}\n`);
          return res.status === 'ok' ? 0 : 1;
        }
        const res = await runObjective({
          config,
          repoDir: repo,
          runId: parsed.runId,
          adapter,
          ask,
          say: out,
          identity: deps.identity,
        });
        out(`${JSON.stringify(res)}\n`);
        return res.status === 'ok' ? 0 : 1;
      } finally {
        rl.close();
      }
    }
    if (cmd === 'reverse') {
      const res = await runReverse({
        config,
        repoDir: repo,
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
      repoDir: repo,
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
