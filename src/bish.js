import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { resolveAdapter, defaultRegistry } from './adapters/index.js';
import { acquireRunLock } from './run-lock.js';
import { runInterviewLoop } from './bish-interview-loop.js';
import { runInitialSpec, README_FILE } from './bish-initial-spec.js';
import { createLogger } from './bish-log.js';
import { runReverse } from './bish-reverse.js';
import { debugAdapter, createAsker, askChoice, parseRunArgs, loadRunProject } from './cli-lib.js';
import { formatInterviewLoopResult, formatReverseResult } from './cli-format.js';
import { initProject, ADAPTER_CHOICES, MODEL_CHOICES } from './init.js';
import { CONFIG_FILE } from './project-config.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const INTERVIEW_FILE = '.bish-bash-bosh/interview.md';
const SPEC_FILE = '.bish-bash-bosh/specification.md';
const LOG_FILE = '.bish-bash-bosh/bish-log.md';

// `bish`: the interview flow that gathers requirements and writes specs, or (with --reverse)
// the reverse-engineering flow that writes specs + characterization tests from existing code.
// Always operates on the current project (cwd); there is no sandbox dir separate from it.
export async function runBish(argv, deps, out, err) {
  const { label, reverse, debug, parsed } = parseRunArgs('bish', argv);
  if (!parsed.ok) {
    err(`${label}: ${parsed.error}\n`);
    return 2;
  }
  if (!reverse && !existsSync(README_FILE)) {
    err(`${label}: ${README_FILE} not found in the project root; write one describing the project, then run bish again\n`);
    return 2;
  }
  const { ask, close } = createAsker(deps.input ?? process.stdin, out);
  try {
    if (!existsSync(CONFIG_FILE)) {
      const adapter = await askChoice(ask, out, 'adapter', ADAPTER_CHOICES);
      if (!adapter) {
        err(`${label}: aborted (no adapter given)\n`);
        return 2;
      }
      const choices = MODEL_CHOICES[adapter];
      const model = choices ? await askChoice(ask, out, 'model', choices) : await ask('model: ');
      if (!model) {
        err(`${label}: aborted (no model given)\n`);
        return 2;
      }
      const res = initProject({ dir: '.', adapter, model });
      if (!res.ok) {
        err(`${label}: ${res.reason}\n`);
        return 1;
      }
      out(`Wrote${res.committed ? ' and committed' : ''} ${CONFIG_FILE} (adapter: ${adapter}, model: ${model}).\n`);
      if (!res.committed) {
        out(`Commit it before running bish/bosh when a clean working tree is required:\n  git add ${CONFIG_FILE} && git commit -m "bish: add config"\n`);
      }
    }
    const project = loadRunProject(label, err);
    if (!project) return 2;
    return await runConfiguredBish(project, { reverse, debug, parsed }, deps, out, err, ask);
  } catch (e) {
    if (debug) out(`[debug] ${e.stack}\n`);
    err(`${label}: ${e.message}\n`);
    return 2;
  } finally {
    close();
  }
}

async function runConfiguredBish(project, { reverse, debug, parsed }, deps, out, err, ask) {
  const { config, repo } = project;
  // The very first `bish` run in a project (no interview.md yet) seeds the interview store and spec
  // file from their templates, creates an empty bish-log.md (every prompt sent to the agent and every
  // piece of its own output shown in the console gets appended there from then on, see bish-log.js),
  // then makes one agent call (prompts/initial-spec.md) that turns README.md into a baseline spec and
  // the first interview questions. It stops there so the owner can review before the interview starts.
  const firstRun = !reverse && !existsSync(join(repo, INTERVIEW_FILE));
  // A restart after the first run: both files should already exist; self-heal spec.md alone if it
  // was somehow lost, rather than failing a run the owner can otherwise just continue.
  if (!reverse && !firstRun && !existsSync(join(repo, SPEC_FILE))) {
    writeFileSync(join(repo, SPEC_FILE), readFileSync(join(templatesDir, 'specification-template.md'), 'utf8'));
  }
  const lock = acquireRunLock(project.dir);
  if (!lock.ok) {
    err(`bish: ${lock.error}\n`);
    return 2;
  }
  try {
    const label = reverse ? 'reverse' : 'interview';
    const adapter = debugAdapter(resolveAdapter(config, deps.registry ?? defaultRegistry), label, debug, out);
    if (firstRun) {
      const specTemplate = readFileSync(join(templatesDir, 'specification-template.md'), 'utf8');
      const seeded = [INTERVIEW_FILE, SPEC_FILE, LOG_FILE].map((f) => join(repo, f));
      writeFileSync(seeded[0], readFileSync(join(templatesDir, 'interview-template.md'), 'utf8'));
      writeFileSync(seeded[1], specTemplate);
      writeFileSync(seeded[2], '');
      try {
        await runInitialSpec({
          adapter,
          repoDir: repo,
          readFile: (p) => readFileSync(p, 'utf8'),
          specPath: seeded[1],
          interviewPath: seeded[0],
          specTemplate,
          say: out,
          log: createLogger(seeded[2]),
        });
      } catch (e) {
        for (const f of seeded) rmSync(f, { force: true });
        throw e;
      }
      out(`Wrote ${SPEC_FILE} and ${INTERVIEW_FILE} from README.md.\nReview them, then run \`bish\` again to start the interview.\n`);
      return 0;
    }
    if (!reverse) {
      // Each round's answer is captured by the deterministic checkbox walk below; the agent only
      // sees one question/answer at a time (prompts/interview-loop.md), with the same session
      // (persisted to config.yml's `bishSession` field, distinct from other phases, which
      // never use it) carrying the rest of the conversation's context across rounds and across
      // separate `bish` invocations.
      const res = await runInterviewLoop({
        interviewPath: join(repo, INTERVIEW_FILE),
        readFile: (p) => readFileSync(p, 'utf8'),
        writeFile: (p, s) => writeFileSync(p, s),
        ask,
        say: out,
        adapter,
        repoDir: repo,
        loadSession: () => config.bishSession,
        saveSession: (session) => {
          config.bishSession = session;
          writeFileSync(project.configPath, stringifyYaml(config));
        },
        log: createLogger(join(repo, LOG_FILE)),
      });
      out(formatInterviewLoopResult(res));
      return res.status === 'ok' ? 0 : 1;
    }
    const res = await runReverse({
      config,
      repoDir: repo,
      runId: parsed.runId,
      adapter,
      testCommand: deps.testCommand,
      identity: deps.identity,
    });
    out(formatReverseResult(res));
    return res.status === 'ok' ? 0 : 1;
  } finally {
    lock.release();
  }
}
