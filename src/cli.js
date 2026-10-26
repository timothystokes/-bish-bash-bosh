import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadSandbox, CONFIG_FILE } from './sandbox.js';
import { resolveAdapter, defaultRegistry } from './adapters/index.js';
import { runStep } from './step.js';
import { runLoop } from './driver.js';
import { acquireRunLock } from './run-lock.js';
import { lintSpecs } from './spec-lint.js';
import { checkReadiness, hasObjectiveKit } from './readiness.js';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { runObjective } from './objective.js';
import { runReverse } from './reverse.js';
import { initSandbox, addObjectiveKit } from './init-sandbox.js';
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
    'hodgepodge: model-agnostic harness for loop-engineered delivery',
    '',
    'Three programs, one flow: `hodgepodge init`, then `hodge` (requirements and specs), then `podge` (plan and implementation).',
    '',
    'Usage:',
    '  hodgepodge init --dir <sandbox> --adapter <id> --model <id> [--seed toy|empty|objective]',
    '  hodge  [--dir <sandbox>] [--run-id <id>] [--reverse] [--debug]',
    '  podge  [--dir <sandbox>] [--run-id <id>] [--control <control.json>] [--debug]   (with a `qa` role in hodge.json, done also needs a clean independent QA report; findings return to the plan, up to maxQaCycles)',
    '  podge step [--dir <sandbox>] [--run-id <id>] [--debug]',
    '  --debug (or HODGEPODGE_DEBUG=1) on hodge/podge/podge step: log to stderr each agent call\'s exit status, usage and full transcript, every gate result with its detail, test output on failure, and stack traces. The transcript is agent output, not the environment, but it may contain whatever the agent printed: do not share debug logs unreviewed.',
    '  hodgepodge <command> ...   (the commands below)',
    '  hodge, podge and podge step hold a single-run lock (<sandbox>/.hodge.lock, PID; stale locks are cleared) and refuse to start while another live run holds the sandbox.',
    '  Sandbox commands take --dir <sandbox> (default: the current directory). `hodgepodge init` writes <sandbox>/hodge.json holding the target repo,',
    '  roles, budgets and the path back to hodgepodge, plus hodgepodge/hodge/podge launchers, so after `cd <sandbox>` just run `./hodge` then `./podge`.',
    '  hodgepodge clean-room --source <dir> --repo <builder-dir>',
    '  hodgepodge status [--dir <sandbox>] [--run-id <id>] [--control <control.json>]',
    '  hodgepodge tui --control <control.json> [--dir <sandbox>] [--run-id <id>]',
    '  hodgepodge proxy --upstream <url> [--audit <file>] [--meter <file>] [--port <n>]',
    '  hodgepodge sync --bucket <name> --run-id <id> [--repo <dir> | --dir <sandbox>]',
    '  hodgepodge promote --run-id <id> --head <branch> --base <branch> --bucket <name> [--sha <sha>] [--repo <dir> | --dir <sandbox>]',
    '  hodgepodge spec-lint [--repo <dir> | --dir <sandbox>]',
    '  hodgepodge ready [--repo <dir> | --dir <sandbox>]',
    '  hodgepodge kill --container <name> [--control <control.json>] [--grace <sec>]',
    '  hodgepodge control --file <control.json> pause|resume|stop|steer <note...>',
    '',
    'Spec formats: a spec may declare `## Formats` bullets, checked by `ready` and the loop. Known formats: `asyncapi`, `ebnf`, `gherkin`, `json-schema`, `openapi`.',
    '',
    'Commands:',
    '  init   scaffold a sandbox: <dir>/target (git repo seeded from templates) + <dir>/hodge.json (outside the repo; holds the target repo and a reference back to hodgepodge) + <dir>/hodgepodge, <dir>/hodge and <dir>/podge launchers; refuses dirs inside hodgepodge\n         or non-empty dirs; seed toy (default: spec, red tests, open plan), empty, or objective (objective/ kit: phases, interview protocol, readiness signals, brief and open questions to be filled by `hodge`); every seed configures build, interview and reverse roles; prints JSON {ok, dir, repo, config, hodgepodge}; exit 0 only when ok',
    '  hodge  requirements gathering and spec definition: asks for a description of the objective (not a flag), then alternates agent rounds with your answers (broad first,',
    '         then fine-grained) until you answer `done` (or the agent has no question left) and `hodgepodge ready` passes; spec-lint and readiness run only then, and their gaps come back as questions or spec fixes; no tests are written here; a target without the objective kit gets it first; Ctrl-D or an empty answer pauses and a rerun resumes;',
    '         with --reverse it instead runs the `reverse` role to write specs/ + characterization tests from existing code (commits only if only specs/tests changed,',
    '         spec-lint passes and the test suite is green); prints JSON {status, ...}; exit 0 only when ok',
    '  podge  planning and implementation: with specs but no tests/PLAN.md the first step writes the test plan, red tests and plan.md; then loops steps until the plan is done and verified (suite, types, every R-<spec>-<n> named by a passing test; writes runs/<id>/done.json) (plus a clean independent QA report when config has a `qa` role) or a step fails/gates/runs out of budget (failed iterations write diagnosis.json: root cause, evidence, fix, test, prevention) (--control <file> honours control.json);',
    '         prints JSON {status, steps, reason?}; exit 0 only when done',
    '  podge step  run one loop iteration (the unit `podge` and the cloud driver repeat); prints JSON {sha, iteration, cost, status}',
    '         (--dir defaults to ., --run-id defaults to "default")',
    '  clean-room  export only specs/ + tests/ from --source into a fresh git repo at --repo (the builder never sees source); prints JSON {ok, sha, files};',
    '         exit 0 only when ok. Then run `podge` there with config mode clean-room (firewall gate checks the bundle first)',
    '  status  print JSON run status: iterations, tokens, cost, seconds vs budgets, plus `details` (declared formats, readiness by dimension, QA findings, done evidence) and control state with --control',
    '  tui    live terminal view: log tail, cost meter vs budget, declared formats, readiness by dimension, QA findings, done evidence; keys p pause, r resume, s steer, x stop (confirmed), q quit',
    '  proxy  secret-redacting, usage-metering proxy in front of a model endpoint; prints JSON {port} then serves until SIGINT/SIGTERM',
    '  ready  check the specs are captured at a fine grain (granularity, testable/atomic requirements, negative paths, no vague words or unmeasured non-functional requirements, all ten dimensions covered or n/a with a reason per spec, no placeholders,\n         no open questions); prints JSON {ready, gaps}; exit 0 only when ready. `podge` is gated by it when the target has an objective kit',
    '  spec-lint  check specs/*.md structure, Implementation field, requirement IDs and tests/PLAN.md mapping; prints JSON {ok, problems};',
    '         exit 0 only when clean',
    '  sync   copy runs/<id>/** to S3 (idempotent, needs the `aws` CLI); prints JSON {uploaded, skipped}',
    '  promote  open a promotion-review PR from --head to --base with the commit and artifacts URI (needs `gh`); never merges; prints JSON {url}',
    '  kill   stop the run container: sets stop in --control first (so no new iteration starts), then `docker stop`; prints JSON {stopped, name};\n         exit 0 when stopped or already gone, 1 on docker failure',
    '  control  write pause/resume/stop/steer to a control file read by `podge --control`; prints JSON {ok}',
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
 *   program?: 'hodgepodge',
 * }} CliDeps
 */

/**
 * On a real terminal, readline must own the tty (raw mode, \r as Enter); otherwise a previous child
 * process can leave the tty in a state where Enter never submits the line.
 * @param {NodeJS.ReadableStream} input
 * @returns {import('node:readline').ReadLineOptions}
 */
export function readlineOptions(input) {
  return /** @type {{isTTY?: boolean}} */ (input).isTTY ? { input, output: process.stdout, terminal: true } : { input };
}

/**
 * Undo terminal modes a child process may have left on: kitty keyboard protocol, modifyOtherKeys, bracketed paste;
 * and put the tty back into raw mode so readline sees Enter.
 * @param {NodeJS.ReadableStream & {setRawMode?: (b: boolean) => unknown}} input
 */
function resetTty(input) {
  process.stdout.write('\x1b[<u\x1b[>4;0m\x1b[?2004l');
  input.setRawMode?.(false);
  input.resume();
}

/**
 * In debug mode, print each agent call's exit status, usage, changed files and full transcript to stderr.
 * @param {import('./adapter.js').Adapter} adapter
 * @param {string} role
 * @param {boolean} debug
 * @param {(s: string) => void} err
 * @returns {import('./adapter.js').Adapter}
 */
function debugAdapter(adapter, role, debug, err) {
  if (!debug) return adapter;
  return {
    run: async (req) => {
      err(`[debug] ${role}: agent start (cwd ${req.cwd}, limits ${JSON.stringify(req.limits)})\n`);
      const res = await adapter.run(req);
      err(`[debug] ${role}: exit ${res.exitStatus}, usage ${JSON.stringify(res.usage)}, changed ${JSON.stringify(res.changedFiles)}\n`);
      err(`[debug] ${role}: transcript begin\n${res.transcript}\n[debug] ${role}: transcript end\n`);
      return res;
    },
  };
}

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
  // `podge step` is the only way to run a single iteration; there is no top-level `step`.
  const viaPodge = deps.program !== 'hodgepodge' && argv[0] === 'podge' && argv[1] === 'step';
  if (viaPodge) argv = ['step', ...argv.slice(2)];
  const cmd = argv[0];
  if (cmd === 'spec-lint') {
    const rest = argv.slice(1);
    /** @type {Record<string, string | undefined>} */
    const v = {};
    for (let i = 0; i < rest.length; i += 2) {
      const val = rest[i + 1];
      if (!['--repo', '--dir'].includes(rest[i])) {
        err(`hodgepodge spec-lint: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodgepodge spec-lint: ${rest[i]} requires a value\n`);
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
        err(`hodgepodge ready: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodgepodge ready: ${rest[i]} requires a value\n`);
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
        err(`hodgepodge ${cmd}: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodgepodge ${cmd}: ${rest[i]} requires a value\n`);
        return 2;
      }
      v[rest[i]] = val;
    }
    const missing = required.filter((f) => !v[f]);
    if (missing.length > 0) {
      err(`hodgepodge ${cmd}: ${missing.join(', ')} required\n`);
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
      err(`hodgepodge ${cmd}: ${/** @type {Error} */ (e).message}\n`);
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
        err(`hodgepodge init: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodgepodge init: ${rest[i]} requires a value\n`);
        return 2;
      }
      v[rest[i]] = val;
    }
    if (!v['--dir'] || !v['--adapter'] || !v['--model']) {
      err('hodgepodge init: --dir, --adapter and --model are required\n');
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
        err(`hodgepodge clean-room: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodgepodge clean-room: ${rest[i]} requires a value\n`);
        return 2;
      }
      v[rest[i]] = val;
    }
    if (!v['--source'] || !v['--repo']) {
      err('hodgepodge clean-room: --source and --repo are required\n');
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
        err(`hodgepodge proxy: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodgepodge proxy: ${rest[i]} requires a value\n`);
        return 2;
      }
      v[rest[i]] = val;
    }
    if (!v['--upstream']) {
      err('hodgepodge proxy: --upstream <url> is required\n');
      return 2;
    }
    if (!URL.canParse(v['--upstream'])) {
      err(`hodgepodge proxy: invalid --upstream '${v['--upstream']}'\n`);
      return 2;
    }
    const port = v['--port'] === undefined ? 0 : Number(v['--port']);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      err(`hodgepodge proxy: invalid --port '${v['--port']}'\n`);
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
      err(`hodgepodge proxy: ${/** @type {Error} */ (e).message}\n`);
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
        err(`hodgepodge kill: unknown argument '${rest[i]}'\n`);
        return 2;
      }
      if (val === undefined || val.startsWith('--')) {
        err(`hodgepodge kill: ${rest[i]} requires a value\n`);
        return 2;
      }
      v[rest[i]] = val;
    }
    const name = v['--container'];
    if (!name || name.startsWith('-')) {
      err('hodgepodge kill: --container <name> is required (a name, not an option)\n');
      return 2;
    }
    if (v['--grace'] !== undefined && !/^\d+$/.test(v['--grace'])) {
      err('hodgepodge kill: --grace must be a whole number of seconds\n');
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
      err(`hodgepodge kill: ${/** @type {Error} */ (e).message}\n`);
      return 1;
    }
  }
  if (cmd === 'control') {
    const rest = argv.slice(1);
    if (rest[0] !== '--file' || !rest[1] || rest[1].startsWith('--')) {
      err('hodgepodge control: --file <control.json> is required\n');
      return 2;
    }
    const [action, ...note] = rest.slice(2);
    /** @type {Record<string, {paused?: boolean, stop?: boolean, steer?: string}>} */
    const updates = { pause: { paused: true }, resume: { paused: false }, stop: { stop: true } };
    const text = note.join(' ').trim();
    const update = action === 'steer' ? (text ? { steer: text } : undefined) : updates[action ?? ''];
    if (!update || (action !== 'steer' && note.length > 0)) {
      err(`hodgepodge control: expected pause, resume, stop, or steer <note>${action ? ` (got '${action}')` : ''}\n`);
      return 2;
    }
    const res = writeControl(resolve(rest[1]), update);
    out(`${JSON.stringify(res)}\n`);
    return res.ok ? 0 : 1;
  }
  const phase = deps.program !== 'hodgepodge' && (cmd === 'hodge' || cmd === 'podge');
  if (!['status', 'tui'].includes(cmd) && !phase && !(cmd === 'step' && viaPodge)) {
    err(`hodgepodge: unknown command '${argv[0]}'\n\n${helpText()}`);
    return 2;
  }

  const label = cmd === 'hodge' || cmd === 'podge' ? cmd : cmd === 'step' ? 'podge step' : `hodgepodge ${cmd}`;
  // `hodge --reverse` is a bare flag, so it is taken out before the flag/value pairs are parsed.
  const reverse = cmd === 'hodge' && argv.includes('--reverse');
  const debug = argv.includes('--debug') || process.env['HODGEPODGE_DEBUG'] === '1';
  const parsed = parseStepArgs(argv.slice(1).filter((a) => !(reverse && a === '--reverse') && a !== '--debug'), { control: cmd === 'podge' || cmd === 'status' || cmd === 'tui' });
  if (!parsed.ok) {
    err(`${label}: ${parsed.error}\n`);
    return 2;
  }
  if (cmd === 'tui' && !parsed.control) {
    err('hodgepodge tui: --control <control.json> is required\n');
    return 2;
  }
  const sandbox = loadSandbox(parsed.dir);
  if (!sandbox.ok) {
    err(`${label}: ${sandbox.error}\n`);
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
  const lock = acquireRunLock(sandbox.dir);
  if (!lock.ok) {
    err(`${label}: ${lock.error}\n`);
    return 2;
  }
  try {
    const role = cmd === 'hodge' ? (reverse ? 'reverse' : 'interview') : 'build';
    const adapter = debugAdapter(resolveAdapter(config, role, deps.registry ?? defaultRegistry), role, debug, err);
    if (cmd === 'hodge' && !reverse) {
      // The agent runs silently for minutes; say so, or a submitted answer looks like a dead prompt.
      const inner = adapter;
      const announced = {
        run: async (/** @type {Parameters<typeof inner.run>[0]} */ req) => {
          err('\nThinking...\n');
          const res = await inner.run(req);
          err('Agent finished; checking its work.\n');
          return res;
        },
      };
      const input = deps.input ?? process.stdin;
      const tty = /** @type {{isTTY?: boolean}} */ (input).isTTY === true;
      // Piped input must keep one reader (a second one would lose buffered lines); a tty gets a fresh reader per
      // question so tty state left by the agent child (cooked mode, keyboard protocols) cannot break Enter.
      const shared = tty ? undefined : createInterface(readlineOptions(input));
      const sharedLines = shared?.[Symbol.asyncIterator]();
      /** @type {(prompt: string) => Promise<string | null>} */
      const ask = async (prompt) => {
        out(prompt);
        if (sharedLines) {
          const next = await sharedLines.next();
          return next.done ? null : next.value;
        }
        resetTty(input);
        const rl = createInterface(readlineOptions(input));
        try {
          for await (const line of rl) return line;
          return null;
        } finally {
          rl.close();
        }
      };
      const rl = { close: () => shared?.close() };
      try {
        // Interviewing is a conversation, never a single shot: a target without the kit gets it first.
        if (!hasObjectiveKit(repo)) {
          addObjectiveKit(repo);
          execFileSync('git', ['-C', repo, 'add', '-A']);
          execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', '-c', 'user.name=hodge', '-c', 'user.email=hodge@localhost', 'commit', '-q', '-m', 'hodge: add objective kit']);
        }
        const res = await runObjective({
          config,
          repoDir: repo,
          runId: parsed.runId,
          adapter: announced,
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
    if (reverse) {
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
    const run = cmd === 'podge' ? runLoop : runStep;
    const res = await run({
      config,
      repoDir: repo,
      runId: parsed.runId,
      adapter,
      testCommand: deps.testCommand,
      identity: deps.identity,
      ...(cmd === 'podge' && parsed.control ? { controlFile: resolve(parsed.control) } : {}),
      ...(cmd === 'podge' && config.roles['qa'] ? { qaAdapter: debugAdapter(resolveAdapter(config, 'qa', deps.registry ?? defaultRegistry), 'qa', debug, err) } : {}),
      requireTestPlan: /** @type {{requireTestPlan?: boolean}} */ (config).requireTestPlan === true,
      ...(debug ? { log: (/** @type {string} */ m) => err(`[debug] ${m}\n`) } : {}),
    });
    out(`${JSON.stringify(res)}\n`);
    return res.status === 'ok' || res.status === 'done' ? 0 : 1;
  } catch (e) {
    err(`${label}: ${debug ? /** @type {Error} */ (e).stack : /** @type {Error} */ (e).message}\n`);
    return 2;
  } finally {
    lock.release();
  }
}
