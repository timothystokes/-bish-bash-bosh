import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAdapter, defaultRegistry } from '../adapters/index.js';
import { acquireRunLock } from '../shared/run-lock.js';
import { runBuildLoop } from './bosh-build-loop.js';
import { runTestSuite, listTestFiles } from './bosh-test-runner.js';
import { createLogger } from '../bish/bish-log.js';
import { debugAdapter, parseRunArgs, loadRunProject, requireGitRepo } from '../cli/cli-lib.js';
import { commitAll } from '../shared/git-commit.js';
import { formatBuildLoopResult } from '../cli/cli-format.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), 'templates');
const SPEC_FILE = '.bish-bash-bosh/specification.md';
const PLAN_FILE = '.bish-bash-bosh/plan.md';
const LOG_FILE = '.bish-bash-bosh/bosh-log.md';
const HARNESS_FILE = '.bish-bash-bosh/test-harness.js';
const TESTS_DIR = '.bish-bash-bosh/tests';

// `bosh`: the Build Loop (plan.md's prioritised checklist items -> actual files and
// configuration in the project root). Requires plan.md to already exist (written by `bash`, the Plan
// Loop) before it can run at all. Each unprocessed plan item is handed to a fresh-context build agent
// call, gated by bosh's own code running the bundled test harness (never the agent's self-report)
// before and after a fresh-context QA agent call; only once both gates pass is the item ticked (see
// src/bosh/bosh-build-loop.js). Unlike `bish`/`bash` there is no continuing agent session.
export async function runBosh(cmd, argv, deps, out, err) {
  const { label, debug, parsed } = parseRunArgs(cmd, argv);
  if (!parsed.ok) {
    err(`${label}: ${parsed.error}\n`);
    return 2;
  }
  if (!requireGitRepo(label, err)) return 2;
  const project = loadRunProject(label, err);
  if (!project) return 2;
  const { config, repo } = project;
  if (!existsSync(join(repo, PLAN_FILE))) {
    err(`${label}: ${PLAN_FILE} not found. Run \`bash\` first.\n`);
    return 2;
  }
  if (!existsSync(join(repo, LOG_FILE))) writeFileSync(join(repo, LOG_FILE), '');
  if (!existsSync(join(repo, HARNESS_FILE))) {
    writeFileSync(join(repo, HARNESS_FILE), readFileSync(join(templatesDir, 'bosh-test-harness.js'), 'utf8'));
  }
  mkdirSync(join(repo, TESTS_DIR), { recursive: true });
  const lock = acquireRunLock(project.dir);
  if (!lock.ok) {
    err(`${label}: ${lock.error}\n`);
    return 2;
  }
  try {
    const adapter = debugAdapter(resolveAdapter(config, deps.registry ?? defaultRegistry), 'bosh', debug, out);
    const res = await runBuildLoop({
      planPath: join(repo, PLAN_FILE),
      commit: (message) => commitAll(repo, message),
      specPath: existsSync(join(repo, SPEC_FILE)) ? join(repo, SPEC_FILE) : undefined,
      readFile: (p) => readFileSync(p, 'utf8'),
      writeFile: (p, s) => writeFileSync(p, s),
      say: out,
      adapter,
      repoDir: repo,
      runTests: ({ cwd, files }) => runTestSuite(cwd, files),
      listTests: ({ cwd }) => listTestFiles(cwd),
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
