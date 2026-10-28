import { execFileSync } from 'node:child_process';
import { resolveAdapter, defaultRegistry } from './adapters/index.js';
import { acquireRunLock, LOCK_FILE } from './run-lock.js';
import { hasObjectiveKit } from './readiness.js';
import { runObjective } from './hodge-objective.js';
import { runReverse } from './hodge-reverse.js';
import { addObjectiveKit } from './init.js';
import { debugAdapter, createAsker, parseRunArgs, loadRunProject } from './cli-lib.js';

// `hodge`: the interview flow that gathers requirements and writes specs, or (with --reverse)
// the reverse-engineering flow that writes specs + characterization tests from existing code.
// Always operates on the current project (cwd); there is no sandbox dir separate from it.
export async function runHodge(argv, deps, out, err) {
  const { label, reverse, debug, parsed } = parseRunArgs('hodge', argv);
  if (!parsed.ok) {
    err(`${label}: ${parsed.error}\n`);
    return 2;
  }
  const project = loadRunProject(label, err);
  if (!project) return 2;
  const { config, repo } = project;
  const lock = acquireRunLock(project.dir);
  if (!lock.ok) {
    err(`${label}: ${lock.error}\n`);
    return 2;
  }
  try {
    const role = reverse ? 'reverse' : 'interview';
    const adapter = debugAdapter(resolveAdapter(config, role, deps.registry ?? defaultRegistry), role, debug, out);
    if (!reverse) {
      // The agent runs silently for minutes; say so, or a submitted answer looks like a dead prompt.
      const inner = adapter;
      const announced = {
        run: async (req) => {
          err('\nThinking...\n');
          const res = await inner.run(req);
          err('Agent finished; checking its work.\n');
          return res;
        },
      };
      const input = deps.input ?? process.stdin;
      const { ask, close } = createAsker(input, out);
      try {
        // Interviewing is a conversation, never a single shot: a project without the kit gets it first.
        if (!hasObjectiveKit(repo)) {
          addObjectiveKit(repo);
          // `.hodge.lock` lives in the project root now; exclude it from this commit (harness-internal, never committed).
          execFileSync('git', ['-C', repo, 'add', '-A', '--', '.', `:!${LOCK_FILE}`]);
          execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', '-c', 'user.name=hodge', '-c', 'user.email=hodge@localhost', 'commit', '-q', '-m', 'hodge: add objective kit']);
        }
        const res = await runObjective({
          config,
          repoDir: repo,
          runId: parsed.runId,
          adapter: announced,
          ask,
          say: out,
          inboxDir: project.dir,
          identity: deps.identity,
        });
        out(`${JSON.stringify(res)}\n`);
        return res.status === 'ok' ? 0 : 1;
      } finally {
        close();
      }
    }
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
  } catch (e) {
    if (debug) out(`[debug] ${e.stack}\n`);
    err(`${label}: ${e.message}\n`);
    return 2;
  } finally {
    lock.release();
  }
}
