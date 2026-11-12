// Plain-English renderers for the final line(s) a CLI command prints to stdout. Every command used
// to print its raw result object as one JSON line; a human reading a terminal should not have to
// parse JSON to see what happened. Structured artifacts (record.json, done.json, diagnosis.json,
// findings.json) are untouched: those are files for tooling, not terminal output.

const short = (sha) => (sha ? sha.slice(0, 7) : sha);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// `-bish`'s Interview Loop (runInterviewLoop): {status, answered, remaining?}.
export function formatInterviewLoopResult(res) {
  const { status, answered } = res;
  if (status === 'ok' && answered === 0) return 'No unanswered questions in .bish-bash-bosh/interview.md. Add questions to it (or edit specification.md), or run `-bash` next.\n';
  if (status === 'ok') return `Interview complete: ${plural(answered, 'question')} answered this run.\n`;
  return `Paused after ${plural(answered, 'question')}: ${plural(res.remaining, 'question')} left. Run \`-bish\` again to continue.\n`;
}

// `-bash`'s Plan Loop (runPlanLoop): {status, processed}. Unlike the Interview Loop there is no
// pause state: every unprocessed specification item is handed to the agent in one run.
export function formatPlanLoopResult(res) {
  return `Plan complete: ${plural(res.processed, 'item')} processed this run.\n`;
}

// `-bosh`'s Build Loop (runBuildLoop): {status, processed}; 'blocked' when unticked items remain but none has all its dependencies ticked. Same shape and the same reasoning as
// formatPlanLoopResult above: every unprocessed plan.md item is handed to the agent in one run.
export function formatBuildLoopResult(res) {
  if (res.status === 'blocked') {
    return `Build stopped after ${plural(res.processed, 'item')}: ${res.output}. Fix the Depends lines in plan.md, then run \`-bosh\` again.\n`;
  }
  if (res.status === 'empty') {
    return 'Nothing to build: .bish-bash-bosh/plan.md has no checklist items (lines like `1. [ ] P: … T: … S: … D: …`). Run `-bash` to create the plan.\n';
  }
  if (res.status === 'failed') {
    return `Build stopped after ${plural(res.processed, 'item')}: tests failed (or QA kept failing) on "${res.item.phase}: ${res.item.task}" (unticked; run \`-bosh\` again to retry).\n${res.output}\n`;
  }
  if (res.processed === 0 && res.total) return `Nothing to build: all ${plural(res.total, 'plan item')} in plan.md are already ticked.\n`;
  return `Build complete: ${plural(res.processed, 'item')} processed this run.\n`;
}

// `-bish --reverse` (runReverse): {status, sha, reason?}.
export function formatReverseResult(res) {
  const { status, sha, reason } = res;
  if (status === 'ok') return `Reverse-engineered the specification (commit ${short(sha)}).\n`;
  return `Reverse ${status}${reason ? `: ${reason}` : ''}.\n`;
}
