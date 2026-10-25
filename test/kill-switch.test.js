import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stopRun, stopContainer, dockerRunner } from '../src/kill-switch.js';

const ARN = 'arn:aws:states:ap-southeast-2:123456789012:execution:hodge-loop:run-1';

/** @param {(input: {executionArn: string, error?: string, cause?: string}) => Promise<{stopDate: Date}>} [impl] */
function fakeClient(impl) {
  /** @type {{executionArn: string, error?: string, cause?: string}[]} */
  const calls = [];
  return {
    calls,
    stopExecution: async (/** @type {{executionArn: string, error?: string, cause?: string}} */ input) => {
      calls.push(input);
      return impl ? impl(input) : { stopDate: new Date('2026-01-01T00:00:00Z') };
    },
  };
}

test('stopRun calls StopExecution with the execution ARN and a cause', async () => {
  const client = fakeClient();
  const r = await stopRun({ client, executionArn: ARN, cause: 'kill switch' });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].executionArn, ARN);
  assert.equal(client.calls[0].cause, 'kill switch');
  assert.equal(client.calls[0].error, 'KillSwitch');
  assert.deepEqual(r, { stopped: true, executionArn: ARN, stopDate: '2026-01-01T00:00:00.000Z' });
});

test('stopRun sets stop in the control file before stopping, so no successor starts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-kill-'));
  const controlFile = join(dir, 'control.json');
  const client = fakeClient(async () => {
    assert.equal(JSON.parse(readFileSync(controlFile, 'utf8')).stop, true);
    return { stopDate: new Date(0) };
  });
  const r = await stopRun({ client, executionArn: ARN, controlFile });
  assert.equal(r.stopped, true);
  assert.equal(client.calls.length, 1);
});

test('stopRun still stops the execution when the control file is malformed (already a stop)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-kill-'));
  const controlFile = join(dir, 'control.json');
  await import('node:fs').then((fs) => fs.writeFileSync(controlFile, '{nope'));
  const client = fakeClient();
  const r = await stopRun({ client, executionArn: ARN, controlFile });
  assert.equal(r.stopped, true);
  assert.equal(client.calls.length, 1);
});

test('stopRun is idempotent when the execution no longer exists', async () => {
  const client = fakeClient(async () => {
    throw Object.assign(new Error('gone'), { name: 'ExecutionDoesNotExist' });
  });
  const r = await stopRun({ client, executionArn: ARN });
  assert.deepEqual(r, { stopped: false, executionArn: ARN, reason: 'execution does not exist' });
});

test('stopRun rethrows other client errors', async () => {
  const client = fakeClient(async () => {
    throw Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
  });
  await assert.rejects(stopRun({ client, executionArn: ARN }), /denied/);
});

test('stopRun rejects an empty execution ARN without calling the client', async () => {
  const client = fakeClient();
  await assert.rejects(stopRun({ client, executionArn: '' }), /executionArn/);
  assert.equal(client.calls.length, 0);
});

/** @param {(args: string[]) => {code: number, stdout?: string, stderr?: string}} [impl] */
function fakeDocker(impl) {
  /** @type {string[][]} */
  const calls = [];
  return {
    calls,
    run: async (/** @type {string[]} */ args) => {
      calls.push(args);
      const r = impl ? impl(args) : { code: 0 };
      return { stdout: '', stderr: '', ...r };
    },
  };
}

test('stopContainer sets stop in control.json before docker stop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-kill-'));
  const controlFile = join(dir, 'control.json');
  const docker = fakeDocker(() => {
    assert.equal(JSON.parse(readFileSync(controlFile, 'utf8')).stop, true);
    return { code: 0 };
  });
  const r = await stopContainer({ docker: docker.run, name: 'hodge-run-1', controlFile });
  assert.deepEqual(docker.calls, [['stop', '--time', '10', 'hodge-run-1']]);
  assert.deepEqual(r, { stopped: true, name: 'hodge-run-1' });
});

test('stopContainer reports a vanished container as not stopped, without throwing', async () => {
  const docker = fakeDocker(() => ({ code: 1, stderr: 'Error response from daemon: No such container: x' }));
  const r = await stopContainer({ docker: docker.run, name: 'x' });
  assert.deepEqual(r, { stopped: false, name: 'x', reason: 'container does not exist' });
});

test('stopContainer throws on other docker failures, after setting stop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hodge-kill-'));
  const controlFile = join(dir, 'control.json');
  const docker = fakeDocker(() => ({ code: 1, stderr: 'Cannot connect to the Docker daemon' }));
  await assert.rejects(stopContainer({ docker: docker.run, name: 'x', controlFile }), /Cannot connect/);
  assert.equal(JSON.parse(readFileSync(controlFile, 'utf8')).stop, true);
});

test('stopContainer requires a name and rejects option-like names', async () => {
  const docker = fakeDocker();
  await assert.rejects(stopContainer({ docker: docker.run, name: '' }), /name is required/);
  await assert.rejects(stopContainer({ docker: docker.run, name: '--all' }), /invalid container name/);
  assert.equal(docker.calls.length, 0);
});

test('dockerRunner executes the docker binary and returns code and output', async () => {
  const r = await dockerRunner('node')(['-e', 'console.log("hi"); process.exit(3)']);
  assert.equal(r.code, 3);
  assert.equal(r.stdout.trim(), 'hi');
});
