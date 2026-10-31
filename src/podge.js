import { resolve } from 'node:path';
import { resolveAdapter, defaultRegistry } from './adapters/index.js';
import { acquireRunLock } from './run-lock.js';
import { runStep } from './podge-step.js';
import { runLoop } from './podge-driver.js';
import { debugAdapter, parseRunArgs, loadRunProject } from './cli-lib.js';
import { formatStepResult, formatLoopResult } from './cli-format.js';

// `podge`: the build loop (specs -> test plan -> red tests -> implementation steps until the plan is
// done and verified). `podge step` (routed here as cmd 'step') runs a single iteration.
export async function runPodge(cmd, argv, deps, out, err) {
  const { label, debug, parsed } = parseRunArgs(cmd, argv);
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
    const adapter = debugAdapter(resolveAdapter(config, deps.registry ?? defaultRegistry), 'build', debug, out);
    const run = cmd === 'podge' ? runLoop : runStep;
    const res = await run({
      config,
      repoDir: repo,
      runId: parsed.runId,
      adapter,
      testCommand: deps.testCommand,
      identity: deps.identity,
      inboxDir: project.dir,
      ...(cmd === 'podge' && parsed.control ? { controlFile: resolve(parsed.control) } : {}),
      ...(cmd === 'podge' && config.maxQaCycles !== undefined ? { qaAdapter: debugAdapter(resolveAdapter(config, deps.registry ?? defaultRegistry), 'qa', debug, out) } : {}),
      requireTestPlan: true,
      ...(debug ? { log: (m) => out(`[debug] ${m}\n`) } : {}),
    });
    out(cmd === 'podge' ? formatLoopResult(res) : formatStepResult(res));
    return res.status === 'ok' || res.status === 'done' ? 0 : 1;
  } catch (e) {
    if (debug) out(`[debug] ${e.stack}\n`);
    err(`${label}: ${e.message}\n`);
    return 2;
  } finally {
    lock.release();
  }
}
