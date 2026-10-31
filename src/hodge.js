import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAdapter, defaultRegistry } from './adapters/index.js';
import { acquireRunLock } from './run-lock.js';
import { runInterviewLoop } from './hodge-interview-loop.js';
import { runReverse } from './hodge-reverse.js';
import { debugAdapter, createAsker, parseRunArgs, loadRunProject } from './cli-lib.js';
import { formatInterviewLoopResult, formatReverseResult } from './cli-format.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const INTERVIEW_FILE = '.hodgepodge/interview.md';
const SPEC_FILE = '.hodgepodge/spec.md';

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
  // The very first `hodge` run in a project just seeds the interview store and spec file from
  // their templates: no agent call, no lock, no run folder. Later runs proceed as usual.
  if (!reverse && !existsSync(join(repo, INTERVIEW_FILE))) {
    writeFileSync(join(repo, INTERVIEW_FILE), readFileSync(join(templatesDir, 'interview-template.md'), 'utf8'));
    writeFileSync(join(repo, SPEC_FILE), readFileSync(join(templatesDir, 'spec-template.md'), 'utf8'));
    out(`Wrote ${INTERVIEW_FILE} and ${SPEC_FILE} from their templates.\nRun \`hodge\` again to start the interview.\n`);
    return 0;
  }
  // A restart after the first run: both files should already exist; self-heal spec.md alone if it
  // was somehow lost, rather than failing a run the owner can otherwise just continue.
  if (!reverse && !existsSync(join(repo, SPEC_FILE))) {
    writeFileSync(join(repo, SPEC_FILE), readFileSync(join(templatesDir, 'spec-template.md'), 'utf8'));
  }
  const lock = acquireRunLock(project.dir);
  if (!lock.ok) {
    err(`${label}: ${lock.error}\n`);
    return 2;
  }
  try {
    const label = reverse ? 'reverse' : 'interview';
    if (!reverse) {
      // The Interview Loop is pure code: no agent, no adapter, just a checkbox walk over interview.md.
      const input = deps.input ?? process.stdin;
      const { ask, close } = createAsker(input, out);
      try {
        const res = await runInterviewLoop({
          interviewPath: join(repo, INTERVIEW_FILE),
          readFile: (p) => readFileSync(p, 'utf8'),
          writeFile: (p, s) => writeFileSync(p, s),
          ask,
          say: out,
        });
        out(formatInterviewLoopResult(res));
        return res.status === 'ok' ? 0 : 1;
      } finally {
        close();
      }
    }
    const adapter = debugAdapter(resolveAdapter(config, deps.registry ?? defaultRegistry), label, debug, out);
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
  } catch (e) {
    if (debug) out(`[debug] ${e.stack}\n`);
    err(`${label}: ${e.message}\n`);
    return 2;
  } finally {
    lock.release();
  }
}
