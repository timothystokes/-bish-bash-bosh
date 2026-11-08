// Plain-English renderers for the final line(s) a CLI command prints to stdout. Every command used
// to print its raw result object as one JSON line; a human reading a terminal should not have to
// parse JSON to see what happened. Structured artifacts (record.json, done.json, diagnosis.json,
// findings.json) are untouched: those are files for tooling, not terminal output.

const short = (sha) => (sha ? sha.slice(0, 7) : sha);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const bullets = (items) => items.map((i) => `  - ${i}`).join('\n');

// `bish`'s Interview Loop (runInterviewLoop): {status, answered, remaining?}.
export function formatInterviewLoopResult(res) {
  const { status, answered } = res;
  if (status === 'ok') return `Interview complete: ${plural(answered, 'question')} answered this run.\n`;
  return `Paused after ${plural(answered, 'question')}: ${plural(res.remaining, 'question')} left. Run \`bish\` again to continue.\n`;
}

// `bash`'s Plan Loop (runPlanLoop): {status, processed}. Unlike the Interview Loop there is no
// pause state: every unprocessed specification item is handed to the agent in one run.
export function formatPlanLoopResult(res) {
  return `Plan complete: ${plural(res.processed, 'item')} processed this run.\n`;
}

// `bosh`'s Build Loop (runBuildLoop): {status, processed}; 'blocked' when unticked items remain but none has all its dependencies ticked. Same shape and the same reasoning as
// formatPlanLoopResult above: every unprocessed plan.md item is handed to the agent in one run.
export function formatBuildLoopResult(res) {
  if (res.status === 'blocked') {
    return `Build stopped after ${plural(res.processed, 'item')}: ${res.output}. Fix the Depends lines in plan.md, then run \`bosh\` again.\n`;
  }
  if (res.status === 'failed') {
    return `Build stopped after ${plural(res.processed, 'item')}: tests failed (or QA kept failing) on "${res.item.phase}: ${res.item.task}" (unticked; run \`bosh\` again to retry).\n${res.output}\n`;
  }
  return `Build complete: ${plural(res.processed, 'item')} processed this run.\n`;
}

// `bish --reverse` (runReverse): {status, sha, reason?}.
export function formatReverseResult(res) {
  const { status, sha, reason } = res;
  if (status === 'ok') return `Reverse-engineered specs and tests (commit ${short(sha)}).\n`;
  return `Reverse ${status}${reason ? `: ${reason}` : ''}.\n`;
}

// `bish-bash-bosh spec-lint` (lintSpecs): {ok, problems}.
export function formatSpecLint(res) {
  if (res.ok) return 'spec-lint: ok\n';
  return `spec-lint: ${plural(res.problems.length, 'problem')}\n${bullets(res.problems)}\n`;
}

// `bish-bash-bosh ready` (checkReadiness): {ready, gaps}.
export function formatReadiness(res) {
  if (res.ready) return 'ready: yes\n';
  return `ready: no (${plural(res.gaps.length, 'gap')})\n${bullets(res.gaps)}\n`;
}

// `bish-bash-bosh promote` (requestPromotion): {url}.
export function formatPromote(res) {
  return `promotion PR opened: ${res.url}\n`;
}

// `bish-bash-bosh clean-room` (exportBundle): {ok, sha?, files?, reason?}.
export function formatCleanRoom(res) {
  if (!res.ok) return `clean-room: failed: ${res.reason}\n`;
  return `clean-room: exported ${plural(res.files.length, 'file')} (commit ${short(res.sha)})\n`;
}

// `bish-bash-bosh control` (writeControl): {ok, reason?}.
export function formatControlWrite(res) {
  return res.ok ? 'control updated\n' : `control update failed: ${res.reason}\n`;
}

// `bish-bash-bosh proxy`: {port}.
export function formatProxyListening(res) {
  return `listening on port ${res.port}\n`;
}

// `bish-bash-bosh status` (readRunStatus, plus optional control state): {runId, iterations, lastStatus, totals, details?}, control?.
export function formatStatus(status, control) {
  const lines = [`run ${status.runId}: ${status.lastStatus ?? 'no iterations yet'} (${plural(status.iterations, 'iteration')}, ${status.totals.seconds ?? 0}s)`];
  if (control) {
    lines.push(control.ok ? `control: ${control.stop ? 'stop requested' : control.paused ? 'paused' : 'running'}${control.steer ? ` (steer queued: ${control.steer})` : ''}` : `control: invalid (${control.reason})`);
  }
  const d = status.details;
  if (d) {
    lines.push(d.formats.length === 0 ? 'formats: none declared' : `formats: ${plural(d.formats.length, 'declared format')}`);
    lines.push(`readiness: ${d.readiness.ready ? 'ready' : `not ready (${plural(d.readiness.gaps, 'gap')})`}`);
    lines.push(d.qa.length === 0 ? 'qa: not run' : `qa: ${d.qa.map((c) => `cycle ${c.cycle} ${c.status}${c.findings.length > 0 ? ` (${plural(c.findings.length, 'finding')})` : ''}`).join(', ')}`);
    lines.push(!d.done ? 'done: no report' : `done: ${d.done.ok ? 'yes' : 'no'} (${d.done.requirements.filter((r) => r.status === 'passing').length}/${plural(d.done.requirements.length, 'requirement')} passing)`);
  }
  return `${lines.join('\n')}\n`;
}
