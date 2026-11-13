import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAdapter, defaultRegistry } from '../adapters/index.js';
import { acquireRunLock } from '../shared/run-lock.js';
import { runPlanLoop } from './bash-plan-loop.js';
import { createLogger } from '../bish/bish-log.js';
import { debugAdapter, parseRunArgs, loadRunProject, requireGitRepo } from '../cli/cli-lib.js';
import { commitAll, subject } from '../shared/git-commit.js';
import { formatPlanLoopResult } from '../cli/cli-format.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), 'templates');
const SPEC_FILE = '.bish-bash-bosh/specification.md';
const PLAN_FILE = '.bish-bash-bosh/plan.md';
const LOG_FILE = '.bish-bash-bosh/bash-log.md';

// `bash`: the Plan Pass (specification.md + the current code -> a prioritised checklist in plan.md) in one
// agent call. The very first `bash` run in a project seeds plan.md from its template, then falls straight
// through into the pass in the same invocation. Later runs re-plan against the code as it now stands. The actual building of files/configuration happens separately,
// under `bosh` (the Build Loop, src/bosh/bosh.js), which requires plan.md to already exist.
export async function runBash(cmd, argv, deps, out, err) {
  const { label, debug, parsed } = parseRunArgs(cmd, argv);
  if (!parsed.ok) {
    err(`${label}: ${parsed.error}\n`);
    return 2;
  }
  if (!requireGitRepo(label, err)) return 2;
  const project = loadRunProject(label, err);
  if (!project) return 2;
  const { config, repo } = project;
  if (!existsSync(join(repo, SPEC_FILE))) {
    err(`${label}: ${SPEC_FILE} not found. Run \`bish\` first.\n`);
    return 2;
  }
  if (!existsSync(join(repo, PLAN_FILE))) {
    writeFileSync(join(repo, PLAN_FILE), readFileSync(join(templatesDir, 'bash-plan.md'), 'utf8'));
    if (!existsSync(join(repo, LOG_FILE))) writeFileSync(join(repo, LOG_FILE), '');
    out(`Wrote ${PLAN_FILE} from its template.\n`);
    // Unlike bish (which needs the owner to actually type an answer before the Interview Loop's
    // first round means anything), nothing here depends on the owner reviewing or editing the
    // freshly-seeded plan.md first: fall straight through into the Plan Loop in this same run.
  }
  const lock = acquireRunLock(project.dir);
  if (!lock.ok) {
    err(`${label}: ${lock.error}\n`);
    return 2;
  }
  try {
    const adapter = debugAdapter(resolveAdapter(config, deps.registry ?? defaultRegistry), 'bash', debug, out);
    const res = await runPlanLoop({
      planPath: join(repo, PLAN_FILE),
      readFile: (p) => readFileSync(p, 'utf8'),
      say: out,
      adapter,
      repoDir: repo,
      log: createLogger(join(repo, LOG_FILE)),
    });
    out(formatPlanLoopResult(res));
    if (commitAll(repo, `bash: write plan (${res.items} tasks, ${res.open} to build)\n\nFirst: ${subject(res.first ?? '')}`)) out('Committed the plan.\n');
    return res.status === 'ok' ? 0 : 1;
  } catch (e) {
    if (debug) out(`[debug] ${e.stack}\n`);
    err(`${label}: ${e.message}\n`);
    return 2;
  } finally {
    lock.release();
  }
}
