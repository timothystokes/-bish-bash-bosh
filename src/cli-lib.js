import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { loadProjectConfig, CONFIG_FILE } from './project-config.js';

export const LOGO = [
  '╷ ╷╭─╮┌─╮╭─╴┌─╴┌─╮╭─╮┌─╮╭─╴┌─╴',
  '├─┤│ ││ ││╶┐├╴ ├─╯│ ││ ││╶┐├╴ ',
  '╵ ╵╰─╯└─╯╰─╯└─╴╵  ╰─╯└─╯╰─╯╰─╴'
].join('\n');

export function helpText() {
  return [
    LOGO,
    '',
    'hodgepodge: model-agnostic harness for loop-engineered delivery',
    '',
    'Three programs, one flow: `hodgepodge init`, then `hodge` (requirements and specs), then `podge` (plan and implementation).',
    '',
    'Usage:',
    '  hodgepodge init   (interactive: asks which adapter/model to use for everything)',
    '  hodge  [--run-id <id>] [--reverse] [--debug]',
    '  podge  [--run-id <id>] [--control <control.json>] [--debug]   (with `maxQaCycles` in .hodgepodge/config.yml, done also needs a clean QA report; findings return to the plan, up to maxQaCycles)',
    '  podge step [--run-id <id>] [--debug]',
    '  --debug (or HODGEPODGE_DEBUG=1) on hodge/podge/podge step: log to stdout the agent prompt, the agent process raw stdout/stderr live, each call\'s exit status and parsed transcript, every gate result with its detail, test output on failure, and stack traces. The transcript is agent output, not the environment, but it may contain whatever the agent printed: do not share debug logs unreviewed.',
    '  hodgepodge <command> ...   (the commands below)',
    '  hodge, podge and podge step hold a single-run lock (.hodgepodge/lock, PID; stale locks are cleared) and refuse to start while another live run holds the project.',
    '  Every command operates on the current project (cwd); there is no sandbox dir and no `--dir` flag. `hodgepodge init` writes ./.hodgepodge/config.yml holding',
    '  adapter and model, so after `cd` into your project just run `hodgepodge init` once, then `hodge`, then `podge`.',
    '  hodgepodge clean-room --source <dir> --repo <builder-dir>',
    '  hodgepodge status [--run-id <id>] [--control <control.json>]',
    '  hodgepodge tui --control <control.json> [--run-id <id>]',
    '  hodgepodge proxy --upstream <url> [--audit <file>] [--meter <file>] [--port <n>]',
    '  hodgepodge sync --bucket <name> --run-id <id> [--repo <dir>]',
    '  hodgepodge promote --run-id <id> --head <branch> --base <branch> --bucket <name> [--sha <sha>] [--repo <dir>]',
    '  hodgepodge spec-lint [--repo <dir>]',
    '  hodgepodge ready [--repo <dir>]',
    '  hodgepodge kill --container <name> [--control <control.json>] [--grace <sec>]',
    '  hodgepodge control --file <control.json> pause|resume|stop|steer <note...>',
    '  hodgepodge console hodge|podge',
    '',
    'Spec formats: a spec may declare `## Formats` bullets, checked by `ready` and the loop. Known formats: `gherkin`, `json-schema`, `openapi`.',
    '',
    'Commands:',
    '  init   ask which adapter/model to use for everything, then write ./.hodgepodge/config.yml; refuses if ./.hodgepodge/config.yml already exists; no scaffolding (no target repo, no runtime copy, no launcher scripts); prints a short confirmation message; exit 0 only when ok',
    '  hodge  requirements gathering: the very first run only writes `.hodgepodge/interview.md` and `.hodgepodge/spec.md` from their templates and exits (no agent call); run again to start the Interview Loop, which is pure code (no agent): it finds the first unanswered question in `interview.md`, shows it in colour, reads your answer from stdin (Enter alone keeps any existing default text), marks its answered checkbox, and repeats; Ctrl-D (EOF) pauses and a rerun resumes;',
    '         with --reverse it instead reverse-engineers specs/ + characterization tests from existing code (commits only if only specs/tests changed,',
    '         spec-lint passes and the test suite is green); exit 0 only when ok (or, without --reverse, once every question is answered)',
    '  podge  planning and implementation: with specs but no tests/PLAN.md the first step writes the test plan, red tests and plan.md; then loops steps until the plan is done and verified (suite, types, every R-<spec>-<n> named by a passing test; writes .hodgepodge/runs/<id>/done.json) (plus a clean QA report when config has `maxQaCycles`) or a step fails/gates (failed iterations write diagnosis.json: root cause, evidence, fix, test, prevention) (--control <file> honours control.json, the only way to bound an otherwise non-terminating loop);',
    '         prints JSON {status, steps, reason?}; exit 0 only when done',
    '  podge step  run one loop iteration (the unit `podge` and the cloud driver repeat); prints JSON {sha, iteration, status}',
    '         (--run-id defaults to "default")',
    '  clean-room  export only specs/ + tests/ from --source into a fresh git repo at --repo (the builder never sees source); prints JSON {ok, sha, files};',
    '         exit 0 only when ok. Then run `podge` there with config mode clean-room (firewall gate checks the bundle first)',
    '  status  print JSON run status: iterations, seconds, plus `details` (declared formats, readiness by dimension, QA findings, done evidence) and control state with --control',
    '  tui    live terminal view: log tail, seconds and iterations, declared formats, readiness by dimension, QA findings, done evidence; keys p pause, r resume, s steer, x stop (confirmed), q quit',
    '  proxy  secret-redacting, usage-metering proxy in front of a model endpoint; prints JSON {port} then serves until SIGINT/SIGTERM',
    '  ready  check the specs are captured at a fine grain (granularity, testable/atomic requirements, negative paths, no vague words or unmeasured non-functional requirements, all ten dimensions covered or n/a with a reason per spec, no placeholders,\n         no open questions); prints JSON {ready, gaps}; exit 0 only when ready. `podge` is gated by it once the project has started an interview (`.hodgepodge/interview.md` exists)',
    '  spec-lint  check specs/*.md structure, Implementation field, requirement IDs and tests/PLAN.md mapping; prints JSON {ok, problems};',
    '         exit 0 only when clean',
    '  sync   copy .hodgepodge/runs/<id>/** to S3 (idempotent, needs the `aws` CLI); prints JSON {uploaded, skipped}',
    '  promote  open a promotion-review PR from --head to --base with the commit and artifacts URI (needs `gh`); never merges; prints JSON {url}',
    '  kill   stop the run container: sets stop in --control first (so no new iteration starts), then `docker stop`; prints JSON {stopped, name};\n         exit 0 when stopped or already gone, 1 on docker failure',
    '  console  plain outer console (no model, no lock) for a running loop: each line you type is queued as a bullet in ./more-questions.md (hodge: assessed and added to the open questions next round) or ./more-todos.md (podge: added to plan.md by the end-of-session checklist before the next item is assessed); consumed after a successful round/step; /quit or Ctrl-D ends',
    '  control  write pause/resume/stop/steer to a control file read by `podge --control`; prints JSON {ok}',
    '',
  ].join('\n');
}

// helpText() without its leading LOGO + blank line: used where the logo is already printed separately
// (the unknown-command error on stderr, alongside the unconditional per-invocation logo).
export function usageText() {
  return helpText().replace(`${LOGO}\n\n`, '');
}

// Every command works on the current project directory: the config and repo all live in
// `./.hodgepodge/config.yml`. run/status/tui also take --control when opts.control is set.
export function parseStepArgs(args, opts = {}) {
  const flags = ['--run-id', ...(opts.control ? ['--control'] : [])];
  const v = { '--run-id': 'default' };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!flags.includes(flag)) return { ok: false, error: `unknown argument '${flag}'` };
    const val = args[i + 1];
    if (val === undefined || val.startsWith('--')) return { ok: false, error: `${flag} requires a value` };
    v[flag] = val;
  }
  const result = { ok: true, runId: v['--run-id'] };
  if (v['--control']) result.control = v['--control'];
  return result;
}

// The repo a repo-level command works on: an explicit --repo, else the current directory.
export function repoFor(repo) {
  return resolve(repo ?? '.');
}

// Parses a flat list of flag/value pairs against an allow-list, writing a uniform usage error for an
// unknown flag or a missing value. Returns null (after writing the error) instead of throwing, so each
// command can do `const v = parseFlags(...); if (!v) return 2;`.
export function parseFlags(rest, allowed, label, err) {
  const v = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (!allowed.includes(flag)) {
      err(`${label}: unknown argument '${flag}'\n`);
      return null;
    }
    const val = rest[i + 1];
    if (val === undefined || val.startsWith('--')) {
      err(`${label}: ${flag} requires a value\n`);
      return null;
    }
    v[flag] = val;
  }
  return v;
}

// In debug mode, print to stdout the agent process raw stdout/stderr live, then each call's exit status, changed files and parsed transcript.
export function debugAdapter(adapter, label, debug, out) {
  if (!debug) return adapter;
  return {
    run: async (req) => {
      const limitsText = Object.entries(req.limits ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(', ');
      out(`[debug] ${label}: agent start (cwd ${req.cwd}${limitsText ? `, ${limitsText}` : ''})\n[debug] ${label}: prompt begin\n${req.prompt}\n[debug] ${label}: prompt end\n`);
      const res = await adapter.run({ ...req, onOutput: (stream, chunk) => out(stream === 'stdout' ? chunk : `[${label} stderr] ${chunk}`) });
      out(`\n[debug] ${label}: exit ${res.exitStatus}, changed: ${res.changedFiles.length === 0 ? 'none' : res.changedFiles.join(', ')}\n`);
      out(`[debug] ${label}: transcript begin\n${res.transcript}\n[debug] ${label}: transcript end\n`);
      return res;
    },
  };
}

// On a real terminal, readline must own the tty (raw mode, \r as Enter); otherwise a previous child
// process can leave the tty in a state where Enter never submits the line.
export function readlineOptions(input) {
  return input.isTTY ? { input, output: process.stdout, terminal: true } : { input };
}

// Undo terminal modes a child process may have left on: kitty keyboard protocol, modifyOtherKeys, bracketed paste;
// and put the tty back into raw mode so readline sees Enter.
export function resetTty(input) {
  process.stdout.write('\x1b[<u\x1b[>4;0m\x1b[?2004l');
  input.setRawMode?.(false);
  input.resume();
}

// A single question/answer reader shared by `hodge`'s interview and `hodgepodge init`'s adapter/model prompts.
// Piped input must keep one reader (a second one would lose buffered lines); a tty gets a fresh reader
// per question so tty state left by a child process (cooked mode, keyboard protocols) cannot break Enter.
// `defaultValue`, if given, is only pre-filled into a real terminal's editable line (`rl.write`, so it
// behaves exactly as if the owner had typed it: Backspace/Delete erase it character by character, leaving
// `A: ` ready for a fresh answer); piped input has no such line to edit, so it is ignored there and the
// existing "Enter alone accepts the default" fallback (in `runInterviewLoop`) is what applies instead.
export function createAsker(input, out) {
  const tty = input.isTTY === true;
  const shared = tty ? undefined : createInterface(readlineOptions(input));
  const sharedLines = shared?.[Symbol.asyncIterator]();
  const ask = async (prompt, defaultValue) => {
    out(prompt);
    if (sharedLines) {
      const next = await sharedLines.next();
      return next.done ? null : next.value;
    }
    resetTty(input);
    const rl = createInterface(readlineOptions(input));
    if (defaultValue) rl.write(defaultValue);
    try {
      for await (const line of rl) return line;
      return null;
    } finally {
      rl.close();
    }
  };
  return { ask, close: () => shared?.close() };
}

// Prompt with a numbered list of suggested choices (e.g. `init`'s adapter/model picker): prints the
// list, then accepts either the choice's number or any typed value (so a value outside the list, or
// scripted stdin, still works). Returns the chosen string, or '' if the answer is blank.
export async function askChoice(ask, out, label, choices) {
  for (const [i, choice] of choices.entries()) out(`  ${i + 1}) ${choice}\n`);
  const answer = await ask(`${label} (1-${choices.length}, or type your own): `);
  if (!answer) return '';
  const n = Number(answer);
  return Number.isInteger(n) && n >= 1 && n <= choices.length ? choices[n - 1] : answer;
}

// Shared argument shape for hodge/podge/step/status/tui: the display label for error messages, whether
// `hodge --reverse` was passed, debug mode, and the parsed --run-id(/--control) flags.
export function parseRunArgs(cmd, argv) {
  const label = cmd === 'hodge' || cmd === 'podge' ? cmd : cmd === 'step' ? 'podge step' : `hodgepodge ${cmd}`;
  const reverse = cmd === 'hodge' && argv.includes('--reverse');
  const debug = argv.includes('--debug') || process.env['HODGEPODGE_DEBUG'] === '1';
  const parsed = parseStepArgs(argv.slice(1).filter((a) => !(reverse && a === '--reverse') && a !== '--debug'), { control: cmd === 'podge' || cmd === 'status' || cmd === 'tui' });
  return { label, reverse, debug, parsed };
}

// Loads the project config, writing a labelled error (and returning null) on failure.
export function loadRunProject(label, err) {
  const project = loadProjectConfig('.');
  if (!project.ok) {
    err(`${label}: ${project.error}\n`);
    return null;
  }
  return project;
}

export { CONFIG_FILE };
