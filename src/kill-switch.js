import { writeControl } from './control.js';

/**
 * @typedef {{stopExecution(input: {executionArn: string, error?: string, cause?: string}): Promise<{stopDate: Date}>}} StopClient
 * @typedef {{stopped: true, executionArn: string, stopDate: string} | {stopped: false, executionArn: string, reason: string}} StopResult
 */

/**
 * Cloud kill switch (external observer). Sets `stop` in the control file first (when given) so a
 * successor execution cannot start, then calls Step Functions `StopExecution`; the `.sync`
 * RunTask integration then stops the running ECS task. Idempotent for a vanished execution.
 * @param {{client: StopClient, executionArn: string, controlFile?: string, cause?: string}} opts
 * @returns {Promise<StopResult>}
 */
export async function stopRun({ client, executionArn, controlFile, cause = 'kill switch' }) {
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
