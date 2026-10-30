import { readRunStatus } from './status.js';
import { readControl, writeControl } from './control.js';

const KEYS = '[p]ause  [r]esume  [s]teer  [x] stop  [q]uit';

const row = (label, text) => `${label.padEnd(12)}${text}`;

// Declared formats, readiness by dimension, QA findings and done evidence.
export function renderDetails(d) {
  const lines = [
    d.formats.length === 0
      ? row('formats', 'none declared')
      : d.formats.map((f, i) => row(i === 0 ? 'formats' : '', `${f.format} ${f.path}${f.output ? ` -> ${f.output}` : ''}  (${f.spec})`)).join('\n'),
    row('readiness', d.readiness.ready ? 'READY' : `NOT READY (${d.readiness.gaps} gaps)`),
  ];
  for (const s of d.readiness.specs) {
    const entries = Object.entries(s.dimensions);
    const open = entries.filter(([, v]) => v !== 'covered').map(([k, v]) => `${k} ${v === 'n/a' ? v : v.toUpperCase()}`);
    lines.push(`  ${s.spec}  ${entries.length - open.length}/${entries.length} covered${open.length > 0 ? `; ${open.join(', ')}` : ''}`);
  }
  if (d.qa.length === 0) lines.push(row('qa', 'not run'));
  for (const c of d.qa) {
    lines.push(row('qa', `cycle ${c.cycle} ${c.status}${c.findings.length > 0 ? ` (${c.findings.length})` : ''}${c.reason ? `: ${c.reason}` : ''}`));
    for (const f of c.findings) lines.push(`  ${f.severity} ${f.classification} ${f.spec}: ${f.consequence}`);
  }
  if (!d.done) lines.push(row('done', 'no report'));
  else {
    const passing = d.done.requirements.filter((r) => r.status === 'passing').length;
    lines.push(row('done', `${d.done.ok ? 'DONE' : 'NOT DONE'}  ${passing}/${d.done.requirements.length} requirements passing`));
    for (const g of d.done.gaps) lines.push(`  gap: ${g}`);
  }
  return lines.join('\n').split('\n');
}

// Pure renderer for one TUI frame.
export function renderFrame({ status, control, tail, prompt, message = undefined }) {
  const { totals: t } = status;
  const state = !control.ok ? `STOPPED (${control.reason})` : control.stop ? 'STOPPED' : control.paused ? 'PAUSED' : 'RUNNING';
  return [
    `run ${status.runId}  ${state}  last: ${status.lastStatus ?? '-'}`,
    `seconds     ${t.seconds}`,
    `iterations  ${t.iterations}`,
    ...renderDetails(status.details),
    ...(control.ok && control.steer ? [`pending steer: ${control.steer}`] : []),
    '--- log ---',
    ...tail,
    '-----------',
    ...(message ? [message] : []),
    prompt ?? KEYS,
  ].join('\n');
}

// Key-driven TUI state machine; no timers or terminal I/O so it is testable.
export function createTui({ source, runId, controlFile, tailLines = 15 }) {
  let mode = 'normal';
  let note = '';
  let message = '';
  const self = {
    done: false,
    frame() {
      const prompt = mode === 'steer' ? `steer> ${note}` : mode === 'confirm' ? 'confirm stop? [y/n]' : null;
      return renderFrame({
        status: readRunStatus(source, runId),
        control: readControl(controlFile),
        tail: source.tail(runId, tailLines),
        prompt,
        message,
      });
    },
    key(k) {
      const write = (u) => {
        const r = writeControl(controlFile, u);
        message = r.ok ? '' : r.reason;
      };
      if (k === '\x03') {
        self.done = true;
        return 'quit';
      }
      if (mode === 'steer') {
        if (k === '\r' || k === '\n') {
          if (note.trim()) write({ steer: note.trim() });
          mode = 'normal';
          note = '';
        } else if (k === '\x1b') {
          mode = 'normal';
          note = '';
        } else if (k === '\x7f' || k === '\b') note = note.slice(0, -1);
        else if (k >= ' ') note += k;
        return;
      }
      if (mode === 'confirm') {
        if (k === 'y') write({ stop: true });
        mode = 'normal';
        return;
      }
      if (k === 'p') write({ paused: true });
      else if (k === 'r') write({ paused: false });
      else if (k === 's') mode = 'steer';
      else if (k === 'x') mode = 'confirm';
      else if (k === 'q') {
        self.done = true;
        return 'quit';
      }
    },
  };
  return self;
}

// Runs the TUI until the user quits. `input` may be a TTY (raw mode is enabled and restored).
export function runTui({ input, output, intervalMs = 1000, source, runId, controlFile, tailLines = undefined }) {
  const tui = createTui({ source, runId, controlFile, tailLines });
  return new Promise((resolve) => {
    const draw = () => output.write(`\x1b[2J\x1b[H${tui.frame().replace(/\n/g, '\r\n')}\r\n`);
    input.setRawMode?.(true);
    input.setEncoding?.('utf8');
    const timer = setInterval(draw, intervalMs);
    const onData = (chunk) => {
      for (const k of String(chunk)) tui.key(k);
      if (tui.done) {
        clearInterval(timer);
        input.removeListener('data', onData);
        input.setRawMode?.(false);
        input.pause?.();
        resolve();
      } else draw();
    };
    input.on('data', onData);
    draw();
  });
}
