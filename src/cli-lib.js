import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { loadProjectConfig, CONFIG_FILE } from './project-config.js';

export const LOGO = [
  '\x1b[0;34m╷ ╷╭─╮┌─╮\x1b[0;32m╭─╴┌─╴\x1b[0;33m┌─╮╭─╮\x1b[0;31m┌─╮╭─╴┌─╴\x1b[0m',
  '\x1b[0;34m├─┤│ ││ │\x1b[0;32m│╶┐├╴ \x1b[0;33m├─╯│ │\x1b[0;31m│ ││╶┐├╴ \x1b[0m',
  '\x1b[0;34m╵ ╵╰─╯└─╯\x1b[0;32m╰─╯└─╴\x1b[0;33m╵  ╰─╯\x1b[0;31m└─╯╰─╯└─╴\x1b[0m'
].join('\n');

export function helpText() {
  return [
    LOGO,
    '',
    'hodgepodge: model-agnostic harness for loop-engineered delivery',
    '',
    'Three loops, one flow: `hodgepodge init`, then `hodge` (requirements and specs), `gepo` (plan), `podge` (build).',
    '',
    'Usage:',
    '  hodgepodge init   (interactive: asks which adapter/model to use for everything)',
    '  hodge  [--run-id <id>] [--reverse] [--debug]',
    '  gepo   [--run-id <id>] [--debug]',
    '  podge  [--run-id <id>] [--debug]',
    '  --debug (or HODGEPODGE_DEBUG=1) on hodge/gepo/podge: log to stdout the agent prompt, the agent process raw stdout/stderr live, each call\'s exit status, changed files and parsed transcript, and stack traces. The transcript is agent output, not the environment, but it may contain whatever the agent printed: do not share debug logs unreviewed.',
    '  hodgepodge <command> ...   (the commands below)',
    '  hodge, gepo and podge hold a single-run lock (.hodgepodge/lock, PID; stale locks are cleared) and refuse to start while another live run holds the project.',
    '  Every command operates on the current project (cwd); there is no sandbox dir and no `--dir` flag. `hodgepodge init` writes ./.hodgepodge/config.yml holding',
    '  adapter and model, so after `cd` into your project just run `hodgepodge init` once, then `hodge`, then `gepo`, then `podge`.',
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
    '  hodge  requirements gathering: the very first run only writes `.hodgepodge/interview.md` and `.hodgepodge/specification.md` from their templates and exits (no agent call); run again to start the Interview Loop, which is pure code (no agent): it finds the first unanswered question in `interview.md`, shows it in colour, reads your answer from stdin (Enter alone keeps any existing default text), hands the round to the agent, marks its answered checkbox, and repeats; Ctrl-D (EOF) pauses and a rerun resumes;',
    '         with --reverse it instead reverse-engineers specs/ + characterization tests from existing code (commits only if only specs/tests changed,',
    '         spec-lint passes and the test suite is green); exit 0 only when ok (or, without --reverse, once every question is answered)',
    '  gepo   plan: refuses to run until `.hodgepodge/specification.md` exists (run `hodge` first); the very first run writes `.hodgepodge/plan.md` from its template, then falls straight into the Plan Loop, which hands each unprocessed specification.md item to the agent in turn (one dependency-ordered checklist per item, appended to plan.md) until every item is processed;',
    '         prints a plain summary of items processed; exit 0 only when ok',
    '  podge  build: refuses to run until `.hodgepodge/plan.md` exists (run `gepo` first); the Build Loop hands each unprocessed plan.md item to the agent in turn, writing the actual files and configuration for it in the project root, until every item is processed;',
    '         prints a plain summary of items processed; exit 0 only when ok',
    '  clean-room  export only specs/ + tests/ from --source into a fresh git repo at --repo (the builder never sees source); prints JSON {ok, sha, files};',
    '         exit 0 only when ok',
    '  status  print JSON run status: iterations, seconds, plus `details` (declared formats, readiness by dimension) and control state with --control',
    '  tui    live terminal view: log tail, seconds and iterations, declared formats, readiness by dimension; keys p pause, r resume, s steer, x stop (confirmed), q quit',
    '  proxy  secret-redacting, usage-metering proxy in front of a model endpoint; prints JSON {port} then serves until SIGINT/SIGTERM',
    '  ready  check the specs are captured at a fine grain (granularity, testable/atomic requirements, negative paths, no vague words or unmeasured non-functional requirements, all ten dimensions covered or n/a with a reason per spec, no placeholders,\n         no open questions); prints JSON {ready, gaps}; exit 0 only when ready',
    '  spec-lint  check specs/*.md structure, Implementation field, requirement IDs and tests/PLAN.md mapping; prints JSON {ok, problems};',
    '         exit 0 only when clean',
    '  sync   copy .hodgepodge/runs/<id>/** to S3 (idempotent, needs the `aws` CLI); prints JSON {uploaded, skipped}',
    '  promote  open a promotion-review PR from --head to --base with the commit and artifacts URI (needs `gh`); never merges; prints JSON {url}',
    '  kill   stop the run container: sets stop in --control first (so no new iteration starts), then `docker stop`; prints JSON {stopped, name};\n         exit 0 when stopped or already gone, 1 on docker failure',
    '  console  plain outer console (no model, no lock) for a running loop: each line you type is queued as a bullet in ./more-questions.md (hodge: assessed and added to the open questions next round) or ./more-todos.md (podge: added to plan.md by the end-of-session checklist before the next item is assessed); consumed after a successful round/item; /quit or Ctrl-D ends',
    '  control  write pause/resume/stop/steer to a control file read by `hodgepodge tui`/`status`; prints JSON {ok}',
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
// process can leave the tty in a state where Enter never submits the line. `output` defaults to
// process.stdout but is overridable (tests inject a capturing stream to assert the exact bytes a
// real terminal would receive).
/**
 * @param {NodeJS.ReadableStream & { isTTY?: boolean }} input
 * @param {NodeJS.WritableStream} [output]
 */
export function readlineOptions(input, output = process.stdout) {
  return input.isTTY ? { input, output, terminal: true } : { input };
}

// Undo terminal modes a child process may have left on: kitty keyboard protocol, modifyOtherKeys, bracketed paste;
// and put the tty back into raw mode so readline sees Enter.
export function resetTty(input) {
  process.stdout.write('\x1b[<u\x1b[>4;0m\x1b[?2004l');
  input.setRawMode?.(false);
  input.resume();
}

const GREY = '\x1b[90m';

// The last SGR (color) escape sequence appearing anywhere in `prompt` — i.e. whatever color is
// still active once the prompt's own text has been printed, so the grey default and the owner's
// own typing can both be returned to it.
function lastColor(prompt) {
  const matches = [...prompt.matchAll(/\x1b\[[0-9;]*m/g)];
  return matches.length ? matches[matches.length - 1][0] : '';
}

// A single question/answer reader shared by `hodge`'s interview and `hodgepodge init`'s adapter/model prompts.
// Piped input must keep one reader (a second one would lose buffered lines); a tty gets a fresh reader
// per question so tty state left by a child process (cooked mode, keyboard protocols) cannot break Enter.
// On a real terminal, `defaultValue` is shown in grey as a suggestion ahead of the cursor, in the
// prompt's own color otherwise (so typed text matches it) — not actually in the editable line, since an
// owner must be able to erase the whole thing in a single Backspace/Delete, not character by character.
// The first keypress other than Enter clears that suggestion and marks the line "touched"; Enter with
// no other keypress first submits the suggestion verbatim, exactly as if the owner had typed it —
// recoloring the grey suggestion to the prompt's own color as it is accepted, so it no longer reads as
// a mere suggestion. Piped input has no such line to edit, so `defaultValue` is ignored there — the
// "Enter alone accepts the default" fallback piped callers rely on lives in `runInterviewLoop` instead.
/**
 * @param {NodeJS.ReadableStream & { isTTY?: boolean }} input
 * @param {(s: string) => void} out
 * @param {NodeJS.WritableStream} [output]
 */
export function createAsker(input, out, output = process.stdout) {
  const tty = input.isTTY === true;
  const shared = tty ? undefined : createInterface(readlineOptions(input));
  const sharedLines = shared?.[Symbol.asyncIterator]();
  const ask = async (prompt, defaultValue) => {
    if (sharedLines) {
      out(prompt);
      const next = await sharedLines.next();
      return next.done ? null : next.value;
    }
    resetTty(input);
    const rl = createInterface(readlineOptions(input, output));
    rl.setPrompt(prompt);
    rl.prompt();
    if (!defaultValue) {
      try {
        for await (const line of rl) return line;
        return null;
      } finally {
        rl.close();
      }
    }
    let touched = false;
    let settled = false;
    output.write(`${GREY}${defaultValue}${lastColor(prompt)}`);
    output.write(`\x1b[${defaultValue.length}D`);
    const onKeypress = (_ch, key) => {
      if (touched || settled) return;
      if (key && (key.name === 'return' || key.name === 'enter')) {
        // Accepting the grey suggestion as-is: recolor it to match the prompt's own color (the
        // cursor is still sitting in front of it, unmoved since it was first drawn), so it reads
        // exactly as if it had been typed, rather than staying visibly grey once accepted.
        settled = true;
        output.write(`${lastColor(prompt)}${defaultValue}`);
        return;
      }
      touched = true;
      output.write('\x1b[0K');
    };
    input.prependListener('keypress', onKeypress);
    try {
      for await (const line of rl) return touched ? line : (line === '' ? defaultValue : line);
      return null;
    } finally {
      input.removeListener('keypress', onKeypress);
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

// Shared argument shape for hodge/gepo/podge/status/tui: the display label for error messages, whether
// `hodge --reverse` was passed, debug mode, and the parsed --run-id(/--control) flags.
export function parseRunArgs(cmd, argv) {
  const label = cmd === 'hodge' || cmd === 'gepo' || cmd === 'podge' ? cmd : `hodgepodge ${cmd}`;
  const reverse = cmd === 'hodge' && argv.includes('--reverse');
  const debug = argv.includes('--debug') || process.env['HODGEPODGE_DEBUG'] === '1';
  const parsed = parseStepArgs(argv.slice(1).filter((a) => !(reverse && a === '--reverse') && a !== '--debug'), { control: cmd === 'status' || cmd === 'tui' });
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
