import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { resolveAdapter, defaultRegistry } from './adapters/index.js';
import { acquireRunLock } from './run-lock.js';
import { runBuildLoop } from './podge-build-loop.js';
import { createLogger } from './hodge-log.js';
import { debugAdapter, parseRunArgs, loadRunProject } from './cli-lib.js';
import { formatBuildLoopResult } from './cli-format.js';

const PLAN_FILE = '.hodgepodge/plan.md';
const LOG_FILE = '.hodgepodge/podge-log.md';

// `podge`: the Build Loop (plan.md's dependency-ordered checklist items -> actual files and
// configuration in the project root). Requires plan.md to already exist (written by `gepo`, the Plan
// Loop) before it can run at all. Each unprocessed plan item is handed to the agent in turn, same
// shape as the Plan Loop: no pause, one continuing agent session across the whole loop.
export async function runPodge(cmd, argv, deps, out, err) {
  const { label, debug, parsed } = parseRunArgs(cmd, argv);
  if (!parsed.ok) {
    err(`${label}: ${parsed.error}\n`);
    return 2;
  }
  const project = loadRunProject(label, err);
  if (!project) return 2;
  const { config, repo } = project;
  if (!existsSync(join(repo, PLAN_FILE))) {
    err(`${label}: ${PLAN_FILE} not found. Run \`gepo\` first.\n`);
    return 2;
  }
  if (!existsSync(join(repo, LOG_FILE))) writeFileSync(join(repo, LOG_FILE), '');
  const lock = acquireRunLock(project.dir);
  if (!lock.ok) {
    err(`${label}: ${lock.error}\n`);
    return 2;
  }
  try {
    const adapter = debugAdapter(resolveAdapter(config, deps.registry ?? defaultRegistry), 'podge', debug, out);
    const res = await runBuildLoop({
      planPath: join(repo, PLAN_FILE),
      readFile: (p) => readFileSync(p, 'utf8'),
      writeFile: (p, s) => writeFileSync(p, s),
      say: out,
      adapter,
      repoDir: repo,
      loadSession: () => config.podgeSession,
      saveSession: (session) => {
        config.podgeSession = session;
        writeFileSync(project.configPath, stringifyYaml(config));
      },
      log: createLogger(join(repo, LOG_FILE)),
    });
    out(formatBuildLoopResult(res));
    return res.status === 'ok' ? 0 : 1;
  } catch (e) {
    if (debug) out(`[debug] ${e.stack}\n`);
    err(`${label}: ${e.message}\n`);
    return 2;
  } finally {
    lock.release();
  }
}
