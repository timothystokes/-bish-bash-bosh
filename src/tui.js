import { readRunStatus } from './status.js';
import { readControl, writeControl } from './control.js';

/**
 * @typedef {import('./status.js').RunStatus} RunStatus
 * @typedef {import('./status.js').StatusSource} StatusSource
 * @typedef {import('./control.js').ControlState} ControlState
 * @typedef {import('./budget-gate.js').Budgets} Budgets
 */

const KEYS = '[p]ause  [r]esume  [s]teer  [x] stop  [q]uit';

/** @param {number} n */
const usd = (n) => `$${n.toFixed(2)}`;

/**
 * Pure renderer for one TUI frame.
 * @param {{status: RunStatus, control: ControlState, tail: string[], prompt: string | null, message?: string}} f
 * @returns {string}
 */
export function renderFrame({ status, control, tail, prompt, message }) {
  const { totals: t, budgets: b } = status;
  const over = Object.values(status.remaining).some((v) => v < 0);
  const state = !control.ok ? `STOPPED (${control.reason})` : control.stop ? 'STOPPED' : control.paused ? 'PAUSED' : 'RUNNING';
  return [
    `run ${status.runId}  ${state}${over ? '  OVER BUDGET' : ''}  last: ${status.lastStatus ?? '-'}`,
    `cost        ${usd(t.cost)} / ${usd(b.maxCostUsd)}`,
    `tokens      ${t.tokens} / ${b.maxTokens}`,
    `seconds     ${t.seconds} / ${b.maxWallClockSeconds}`,
    `iterations  ${t.iterations} / ${b.maxIterations}`,
    ...(control.ok && control.steer ? [`pending steer: ${control.steer}`] : []),
    '--- log ---',
    ...tail,
    '-----------',
    ...(message ? [message] : []),
    prompt ?? KEYS,
  ].join('\n');
}

/**
 * Key-driven TUI state machine; no timers or terminal I/O so it is testable.
 * @param {{source: StatusSource, runId: string, budgets: Budgets, controlFile: string, tailLines?: number}} o
 */
export function createTui({ source, runId, budgets, controlFile, tailLines = 15 }) {
  /** @type {'normal' | 'steer' | 'confirm'} */
  let mode = 'normal';
  let note = '';
  let message = '';
  const self = {
    done: false,
    frame() {
      const prompt = mode === 'steer' ? `steer> ${note}` : mode === 'confirm' ? 'confirm stop? [y/n]' : null;
      return renderFrame({
        status: readRunStatus(source, runId, budgets),
        control: readControl(controlFile),
        tail: source.tail(runId, tailLines),
        prompt,
        message,
      });
    },
    /**
     * @param {string} k one keypress
     * @returns {'quit' | undefined}
     */
    key(k) {
      /** @param {{paused?: boolean, stop?: boolean, steer?: string}} u */
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

/**
 * Runs the TUI until the user quits. `input` may be a TTY (raw mode is enabled and restored).
 * @param {{
 *   source: StatusSource, runId: string, budgets: Budgets, controlFile: string, tailLines?: number,
 *   input: NodeJS.ReadableStream & {setRawMode?: (b: boolean) => unknown},
 *   output: {write(s: string): unknown},
 *   intervalMs?: number,
 * }} o
 * @returns {Promise<void>}
 */
export function runTui({ input, output, intervalMs = 1000, ...rest }) {
  const tui = createTui(rest);
  return new Promise((resolve) => {
    const draw = () => output.write(`\x1b[2J\x1b[H${tui.frame().replace(/\n/g, '\r\n')}\r\n`);
    input.setRawMode?.(true);
    input.setEncoding?.('utf8');
    const timer = setInterval(draw, intervalMs);
    /** @param {string | Buffer} chunk */
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
