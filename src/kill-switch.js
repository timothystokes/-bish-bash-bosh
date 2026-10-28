import { execFile } from 'node:child_process';
import { writeControl } from './control.js';

// Cloud kill switch (external observer). Sets `stop` in the control file first (when given) so a
// successor execution cannot start, then calls Step Functions `StopExecution`; the `.sync`
// RunTask integration then stops the running ECS task. Idempotent for a vanished execution.
export async function stopRun({ client, executionArn, controlFile = undefined, cause = 'kill switch' }) {
  if (!executionArn) throw new Error('executionArn is required');
  // A malformed control file is already a stop (fail closed), so its refusal is not an error here.
  if (controlFile) writeControl(controlFile, { stop: true });
  try {
    const out = await client.stopExecution({ executionArn, error: 'KillSwitch', cause });
    return { stopped: true, executionArn, stopDate: out.stopDate.toISOString() };
  } catch (e) {
    if (e instanceof Error && e.name === 'ExecutionDoesNotExist') {
      return { stopped: false, executionArn, reason: 'execution does not exist' };
    }
    throw e;
  }
}

// Real `docker` runner (binary overridable for tests).
export function dockerRunner(bin = 'docker') {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(bin, args, (err, stdout, stderr) => {
        if (err && typeof err.code !== 'number') return reject(err);
        resolve({ code: err ? (err.code) : 0, stdout, stderr });
      });
    });
}

// Local kill switch: sets `stop` in the control file first so the loop cannot start another
// iteration, then `docker stop` terminates the run container. A vanished container is not an error.
export async function stopContainer({ docker, name, controlFile = undefined, graceSec = 10 }) {
  if (!name) throw new Error('name is required');
  if (name.startsWith('-')) throw new Error(`invalid container name: ${name}`);
  if (controlFile) writeControl(controlFile, { stop: true });
  const r = await docker(['stop', '--time', String(graceSec), name]);
  if (r.code === 0) return { stopped: true, name };
  if (/no such container/i.test(r.stderr)) return { stopped: false, name, reason: 'container does not exist' };
  throw new Error(`docker stop failed (${r.code}): ${r.stderr.trim()}`);
}
