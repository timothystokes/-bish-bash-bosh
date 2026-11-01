import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { resolveAdapter, defaultRegistry } from './adapters/index.js';
import { acquireRunLock } from './run-lock.js';
import { runPlanLoop } from './gepo-plan-loop.js';
import { createLogger } from './hodge-log.js';
import { debugAdapter, parseRunArgs, loadRunProject } from './cli-lib.js';
import { formatPlanLoopResult } from './cli-format.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const SPEC_FILE = '.hodgepodge/specification.md';
const PLAN_FILE = '.hodgepodge/plan.md';
const LOG_FILE = '.hodgepodge/gepo-log.md';

// `gepo`: the Plan Loop (specification.md -> dependency-ordered checklist items in plan.md). The
// very first `gepo` run in a project seeds plan.md from its template, then falls straight through
// into the Plan Loop in the same invocation (no owner input is needed in between, unlike hodge's
// interview seed). Later runs drain the Plan Loop, handing each unprocessed specification item to the
// agent in turn until none remain. The actual building of files/configuration happens separately,
// under `podge` (the Build Loop, src/podge.js), which requires plan.md to already exist.
export async function runGepo(cmd, argv, deps, out, err) {
  const { label, debug, parsed } = parseRunArgs(cmd, argv);
  if (!parsed.ok) {
    err(`${label}: ${parsed.error}\n`);
    return 2;
  }
  const project = loadRunProject(label, err);
  if (!project) return 2;
  const { config, repo } = project;
  if (!existsSync(join(repo, SPEC_FILE))) {
    err(`${label}: ${SPEC_FILE} not found. Run \`hodge\` first.\n`);
    return 2;
  }
  if (!existsSync(join(repo, PLAN_FILE))) {
    writeFileSync(join(repo, PLAN_FILE), readFileSync(join(templatesDir, 'plan-template.md'), 'utf8'));
    if (!existsSync(join(repo, LOG_FILE))) writeFileSync(join(repo, LOG_FILE), '');
    out(`Wrote ${PLAN_FILE} from its template.\n`);
    // Unlike hodge (which needs the owner to actually type an answer before the Interview Loop's
    // first round means anything), nothing here depends on the owner reviewing or editing the
    // freshly-seeded plan.md first: fall straight through into the Plan Loop in this same run.
  }
  const lock = acquireRunLock(project.dir);
  if (!lock.ok) {
    err(`${label}: ${lock.error}\n`);
    return 2;
  }
  try {
    const adapter = debugAdapter(resolveAdapter(config, deps.registry ?? defaultRegistry), 'gepo', debug, out);
    const res = await runPlanLoop({
      specificationPath: join(repo, SPEC_FILE),
      readFile: (p) => readFileSync(p, 'utf8'),
      writeFile: (p, s) => writeFileSync(p, s),
      say: out,
      adapter,
      repoDir: repo,
      loadSession: () => config.gepoSession,
      saveSession: (session) => {
        config.gepoSession = session;
        writeFileSync(project.configPath, stringifyYaml(config));
      },
      log: createLogger(join(repo, LOG_FILE)),
    });
    out(formatPlanLoopResult(res));
    return res.status === 'ok' ? 0 : 1;
  } catch (e) {
    if (debug) out(`[debug] ${e.stack}\n`);
    err(`${label}: ${e.message}\n`);
    return 2;
  } finally {
    lock.release();
  }
}
