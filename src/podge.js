import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { resolveAdapter, defaultRegistry } from './adapters/index.js';
import { acquireRunLock } from './run-lock.js';
import { runStep } from './podge-step.js';
import { runPlanLoop } from './podge-plan-loop.js';
import { createLogger } from './hodge-log.js';
import { debugAdapter, parseRunArgs, loadRunProject } from './cli-lib.js';
import { formatStepResult, formatPlanLoopResult } from './cli-format.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const SPEC_FILE = '.hodgepodge/specification.md';
const PLAN_FILE = '.hodgepodge/plan.md';
const LOG_FILE = '.hodgepodge/podge-log.md';

// `podge`: for now, only the Plan Loop (specification.md -> dependency-ordered checklist items in
// plan.md). The very first `podge` run in a project seeds plan.md from its template and exits: no
// lock, no agent call. Later runs drain the Plan Loop, handing each unprocessed specification item to
// the agent in turn until none remain. `podge step` (routed here as cmd 'step') is untouched: it still
// runs a single iteration of the older build loop (specs -> test plan -> red tests -> implementation).
export async function runPodge(cmd, argv, deps, out, err) {
  const { label, debug, parsed } = parseRunArgs(cmd, argv);
  if (!parsed.ok) {
    err(`${label}: ${parsed.error}\n`);
    return 2;
  }
  const project = loadRunProject(label, err);
  if (!project) return 2;
  const { config, repo } = project;
  if (cmd === 'podge') {
    if (!existsSync(join(repo, SPEC_FILE))) {
      err(`${label}: ${SPEC_FILE} not found. Run \`hodge\` first.\n`);
      return 2;
    }
    if (!existsSync(join(repo, PLAN_FILE))) {
      writeFileSync(join(repo, PLAN_FILE), readFileSync(join(templatesDir, 'plan-template.md'), 'utf8'));
      if (!existsSync(join(repo, LOG_FILE))) writeFileSync(join(repo, LOG_FILE), '');
      out(`Wrote ${PLAN_FILE} from its template.\nRun \`podge\` again to start the plan loop.\n`);
      return 0;
    }
  }
  const lock = acquireRunLock(project.dir);
  if (!lock.ok) {
    err(`${label}: ${lock.error}\n`);
    return 2;
  }
  try {
    const adapter = debugAdapter(resolveAdapter(config, deps.registry ?? defaultRegistry), 'build', debug, out);
    if (cmd === 'podge') {
      const res = await runPlanLoop({
        specificationPath: join(repo, SPEC_FILE),
        readFile: (p) => readFileSync(p, 'utf8'),
        writeFile: (p, s) => writeFileSync(p, s),
        say: out,
        adapter,
        repoDir: repo,
        loadSession: () => config.planSession,
        saveSession: (session) => {
          config.planSession = session;
          writeFileSync(project.configPath, stringifyYaml(config));
        },
        log: createLogger(join(repo, LOG_FILE)),
      });
      out(formatPlanLoopResult(res));
      return res.status === 'ok' ? 0 : 1;
    }
    const res = await runStep({
      config,
      repoDir: repo,
      runId: parsed.runId,
      adapter,
      testCommand: deps.testCommand,
      identity: deps.identity,
      inboxDir: project.dir,
      requireTestPlan: true,
      ...(debug ? { log: (m) => out(`[debug] ${m}\n`) } : {}),
    });
    out(formatStepResult(res));
    return res.status === 'ok' || res.status === 'done' ? 0 : 1;
  } catch (e) {
    if (debug) out(`[debug] ${e.stack}\n`);
    err(`${label}: ${e.message}\n`);
    return 2;
  } finally {
    lock.release();
  }
}
