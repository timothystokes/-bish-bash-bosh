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

// `-bash`'s single planning pass (runPlanLoop): {status, items, open}.
export function formatPlanLoopResult(res) {
  return `Plan ready: ${plural(res.items, 'item')} in .bish-bash-bosh/plan.md, ${res.open} left to build. Run \`-bosh\` next.\n`;
}

// `-bosh`'s Build Loop (runBuildLoop): {status, processed}.
function formatSpecStatus(spec) {
  if (!spec) return '';
  const ids = (list) => (list.length ? ` (${list.join(', ')})` : '');
  return `Specification: ${spec.verified.length} verified${ids(spec.verified)}, ${spec.failing.length} failing${ids(spec.failing)}, ${spec.uncovered.length} with no tagged tests${ids(spec.uncovered)}.\n`;
}

export function formatBuildLoopResult(res) {
  return formatBuildLoopMain(res) + formatSpecStatus(res.spec);
}

function formatBuildLoopMain(res) {
  if (res.status === 'empty') {
    return 'Nothing to build: .bish-bash-bosh/plan.md has no checklist items (lines like `1. [ ] T: <name> - <detail> S: <ids>`). Run `-bash` to create the plan.\n';
  }
  if (res.status === 'failed') {
    return `Build stopped after ${plural(res.processed, 'item')}: tests failed (or QA kept failing) on "${res.item.task}" (unticked; run \`-bosh\` again to retry).\n${res.output}\n`;
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
