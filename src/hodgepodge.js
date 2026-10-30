import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { CONFIG_FILE } from './project-config.js';
import { lintSpecs } from './spec-lint.js';
import { checkReadiness } from './readiness.js';
import { initProject, ADAPTER_CHOICES, MODEL_CHOICES, ROLE_NAMES } from './init.js';
import { exportBundle } from './clean-room.js';
import { createLocalStatusSource, readRunStatus } from './status.js';
import { readControl, writeControl } from './control.js';
import { runTui } from './tui.js';
import { addEntry, INBOX_FILE } from './inbox.js';
import { stopContainer, dockerRunner } from './kill-switch.js';
import { createSecretProxy } from './secret-proxy.js';
import { syncArtifacts, requestPromotion } from './artifacts.js';
import { createAwsCliS3Client, createGhPrOpener, defaultRun } from './cloud-clients.js';
import { repoFor, parseFlags, parseRunArgs, loadRunProject, createAsker, askChoice } from './cli-lib.js';

// Every top-level command other than `hodge` and `podge`/`podge step`: project init, run observability
// (status, tui, console), cloud sync/promotion, spec/readiness checks, the pause/resume/stop control
// file, the secret-redacting proxy, and the container kill switch.
export async function runHodgepodge(cmd, argv, deps, out, err) {
  if (cmd === 'spec-lint' || cmd === 'ready') {
    const v = parseFlags(argv.slice(1), ['--repo'], `hodgepodge ${cmd}`, err);
    if (!v) return 2;
    const res = cmd === 'spec-lint' ? lintSpecs(repoFor(v['--repo'])) : checkReadiness(repoFor(v['--repo']));
    out(`${JSON.stringify(res)}\n`);
    return (cmd === 'spec-lint' ? res.ok : res.ready) ? 0 : 1;
  }
  if (cmd === 'sync' || cmd === 'promote') {
    const allowed = cmd === 'sync' ? ['--bucket', '--run-id', '--repo'] : ['--bucket', '--run-id', '--head', '--base', '--sha', '--repo'];
    const required = cmd === 'sync' ? ['--bucket', '--run-id'] : ['--bucket', '--run-id', '--head', '--base'];
    const v = parseFlags(argv.slice(1), allowed, `hodgepodge ${cmd}`, err);
    if (!v) return 2;
    const missing = required.filter((f) => !v[f]);
    if (missing.length > 0) {
      err(`hodgepodge ${cmd}: ${missing.join(', ')} required\n`);
      return 2;
    }
    const run = deps.exec ?? defaultRun;
    const repoDir = repoFor(v['--repo']);
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
      err(`hodgepodge ${cmd}: ${e.message}\n`);
      return 2;
    }
  }
  if (cmd === 'init') {
    const v = parseFlags(argv.slice(1), [], 'hodgepodge init', err);
    if (!v) return 2;
    const dir = resolve('.');
    const configPath = join(dir, CONFIG_FILE);
    if (existsSync(configPath)) {
      err(`hodgepodge init: ${configPath} already exists\n`);
      return 1;
    }
    const input = deps.input ?? process.stdin;
    const { ask, close } = createAsker(input, out);
    // Picks for both adapter and model: a numbered list of known options, falling back to whatever
    // is typed (so an unlisted adapter/model, or scripted stdin, still works).
    const askModel = async (adapter, label) => {
      const choices = MODEL_CHOICES[adapter];
      return choices ? askChoice(ask, out, label, choices) : ask(`${label}: `);
    };
    try {
      const adapter = await askChoice(ask, out, 'adapter', ADAPTER_CHOICES);
      if (!adapter) {
        err('hodgepodge init: aborted (no adapter given)\n');
        return 2;
      }
      const model = await askModel(adapter, 'model');
      if (!model) {
        err('hodgepodge init: aborted (no model given)\n');
        return 2;
      }
      const role = { adapter, model };
      const roles = Object.fromEntries(ROLE_NAMES.map((name) => [name, { ...role }]));
      const res = initProject({ dir, roles });
      out(`${JSON.stringify(res)}\n`);
      return res.ok ? 0 : 1;
    } finally {
      close();
    }
  }
  if (cmd === 'clean-room') {
    const v = parseFlags(argv.slice(1), ['--source', '--repo'], 'hodgepodge clean-room', err);
    if (!v) return 2;
    if (!v['--source'] || !v['--repo']) {
      err('hodgepodge clean-room: --source and --repo are required\n');
      return 2;
    }
    const res = exportBundle({ sourceDir: v['--source'], builderDir: v['--repo'] });
    out(`${JSON.stringify(res)}\n`);
    return res.ok ? 0 : 1;
  }
  if (cmd === 'proxy') {
    const v = parseFlags(argv.slice(1), ['--upstream', '--audit', '--meter', '--port'], 'hodgepodge proxy', err);
    if (!v) return 2;
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
      err(`hodgepodge proxy: ${e.message}\n`);
      return 2;
    }
    await stopped;
    await proxy.close();
    return 0;
  }
  if (cmd === 'kill') {
    const v = parseFlags(argv.slice(1), ['--container', '--control', '--grace'], 'hodgepodge kill', err);
    if (!v) return 2;
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
      const stopOpts = { docker: deps.docker ?? dockerRunner(), name };
      if (v['--control']) stopOpts.controlFile = resolve(v['--control']);
      if (v['--grace'] !== undefined) stopOpts.graceSec = Number(v['--grace']);
      const res = await stopContainer(stopOpts);
      out(`${JSON.stringify(res)}\n`);
      return 0;
    } catch (e) {
      err(`hodgepodge kill: ${e.message}\n`);
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
  if (cmd === 'console') {
    const [kind, ...flags] = argv.slice(1);
    if (kind !== 'hodge' && kind !== 'podge') {
      err('hodgepodge console: expected hodge or podge\n');
      return 2;
    }
    if (flags.length > 0) {
      err(`hodgepodge console: unknown argument '${flags[0]}'\n`);
      return 2;
    }
    const dir = resolve('.');
    if (!existsSync(join(dir, CONFIG_FILE))) {
      err(`hodgepodge console: no ${CONFIG_FILE} in ${dir}\n`);
      return 2;
    }
    const file = INBOX_FILE[kind];
    out(`Writing ${file} in ${dir}. One entry per line; /quit or Ctrl-D ends.\n`);
    const rl = createInterface({ input: deps.input ?? process.stdin });
    for await (const line of rl) {
      if (line.trim() === '/quit') break;
      if (line.trim() === '') continue;
      addEntry(dir, kind, line);
      out(`queued in ${file}\n`);
    }
    rl.close();
    return 0;
  }
  // status / tui
  const { label, parsed } = parseRunArgs(cmd, argv);
  if (!parsed.ok) {
    err(`${label}: ${parsed.error}\n`);
    return 2;
  }
  if (cmd === 'tui' && !parsed.control) {
    err('hodgepodge tui: --control <control.json> is required\n');
    return 2;
  }
  const project = loadRunProject(label, err);
  if (!project) return 2;
  const { repo } = project;
  if (cmd === 'tui') {
    await runTui({
      source: createLocalStatusSource(repo),
      runId: parsed.runId,
      controlFile: resolve(parsed.control),
      input: deps.input ?? process.stdin,
      output: { write: out },
    });
    return 0;
  }
  const status = readRunStatus(createLocalStatusSource(repo), parsed.runId);
  const control = parsed.control ? readControl(resolve(parsed.control)) : undefined;
  out(`${JSON.stringify(control ? { ...status, control } : status)}\n`);
  return 0;
}
