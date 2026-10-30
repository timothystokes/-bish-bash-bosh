import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStateMachine } from '../src/state-machine.js';

const config = {
  clusterArn: 'arn:aws:ecs:ap-southeast-2:1:cluster/hodge',
  taskDefinitionArn: 'arn:aws:ecs:ap-southeast-2:1:task-definition/hodge:1',
  subnets: ['subnet-1'],
  securityGroups: ['sg-1'],
  containerName: 'hodge',
  readPointersFunctionArn: 'arn:aws:lambda:ap-southeast-2:1:function:read-pointers',
  stateMachineArn: 'arn:aws:states:ap-southeast-2:1:stateMachine:hodge',
  iterationsPerExecution: 10,
  pollSeconds: 30,
};

/** @param {any} sm @param {string} name */
const state = (sm, name) => {
  assert.ok(sm.States[name], `missing state ${name}`);
  return sm.States[name];
};

test('output is plain JSON and every transition targets an existing state', () => {
  const sm = buildStateMachine(config);
  assert.deepEqual(JSON.parse(JSON.stringify(sm)), sm);
  assert.ok(sm.States[sm.StartAt]);
  for (const [name, s] of Object.entries(sm.States)) {
    const targets = [s.Next, s.Default, ...(s.Choices ?? []).map((/** @type {any} */ c) => c.Next), ...(s.Catch ?? []).map((/** @type {any} */ c) => c.Next)].filter(Boolean);
    for (const t of targets) assert.ok(sm.States[t], `${name} -> ${t} missing`);
    assert.ok(s.Next || s.End || s.Type === 'Choice' || s.Type === 'Succeed' || s.Type === 'Fail', `${name} is a dead end`);
  }
});

test('step runs podge step on Fargate Spot via RunTask.sync', () => {
  const s = state(buildStateMachine(config), 'RunStep');
  assert.equal(s.Resource, 'arn:aws:states:::ecs:runTask.sync');
  assert.equal(s.Parameters.Cluster, config.clusterArn);
  assert.equal(s.Parameters.TaskDefinition, config.taskDefinitionArn);
  assert.deepEqual(s.Parameters.CapacityProviderStrategy, [{ CapacityProvider: 'FARGATE_SPOT', Weight: 1 }]);
  assert.deepEqual(s.Parameters.NetworkConfiguration.AwsvpcConfiguration.Subnets, ['subnet-1']);
  const o = s.Parameters.Overrides.ContainerOverrides[0];
  assert.equal(o.Name, 'hodge');
  assert.deepEqual(o.Command, ['step']);
  assert.ok(o.Environment.some((/** @type {any} */ e) => e.Name === 'HODGE_RUN_ID'));
  assert.equal(s.Next, 'ReadPointers');
});

test('a failed or interrupted task is retried then routed to the pointer check', () => {
  const s = state(buildStateMachine(config), 'RunStep');
  assert.ok(s.Retry.length > 0);
  assert.equal(s.Catch[0].Next, 'ReadPointers');
});

test('pointers come from a light lambda step and are the only execution context', () => {
  const s = state(buildStateMachine(config), 'ReadPointers');
  assert.equal(s.Resource, 'arn:aws:states:::lambda:invoke');
  assert.equal(s.Parameters.FunctionName, config.readPointersFunctionArn);
  assert.equal(s.ResultPath, '$.pointers');
  assert.equal(s.Next, 'Decide');
});

/** @param {any} sm @param {string} next */
const choiceTo = (sm, next) => state(sm, 'Decide').Choices.find((/** @type {any} */ c) => c.Next === next);

test('stop flag halts, checked before pause', () => {
  const sm = buildStateMachine(config);
  const d = state(sm, 'Decide');
  assert.equal(d.Choices[0].Variable, '$.pointers.stop');
  assert.equal(d.Choices[0].BooleanEquals, true);
  assert.equal(state(sm, 'Stopped').Type, 'Succeed');
});

test('pause flag waits then re-reads pointers', () => {
  const sm = buildStateMachine(config);
  assert.equal(choiceTo(sm, 'WaitWhilePaused').Variable, '$.pointers.paused');
  const w = state(sm, 'WaitWhilePaused');
  assert.equal(w.Type, 'Wait');
  assert.equal(w.Seconds, 30);
  assert.equal(w.Next, 'ReadPointers');
});

test('gated last status ends the run as halted', () => {
  const sm = buildStateMachine(config);
  const c = choiceTo(sm, 'Halted');
  assert.equal(c.StringEquals, 'gated');
  assert.equal(state(sm, 'Halted').Type, 'Fail');
});

test('done status ends the run successfully', () => {
  const sm = buildStateMachine(config);
  assert.equal(choiceTo(sm, 'Done').StringEquals, 'done');
  assert.equal(state(sm, 'Done').Type, 'Succeed');
});

test('after N iterations in this execution a successor execution is started with pointers', () => {
  const sm = buildStateMachine(config);
  const c = choiceTo(sm, 'StartSuccessor');
  assert.equal(c.Variable, '$.executionIterations');
  assert.equal(c.NumericGreaterThanEquals, 10);
  const s = state(sm, 'StartSuccessor');
  assert.equal(s.Resource, 'arn:aws:states:::states:startExecution');
  assert.equal(s.Parameters.StateMachineArn, config.stateMachineArn);
  assert.deepEqual(Object.keys(s.Parameters.Input).sort(), ['executionIterations', 'pointers.$', 'runId.$']);
  assert.equal(s.Parameters.Input['executionIterations'], 0);
  assert.equal(s.Next, 'Handoff');
});

test('the default path counts the iteration and runs another step', () => {
  const sm = buildStateMachine(config);
  assert.equal(state(sm, 'Decide').Default, 'CountIteration');
  const s = state(sm, 'CountIteration');
  assert.equal(s.Type, 'Pass');
  assert.equal(s.Next, 'RunStep');
  assert.ok(JSON.stringify(s).includes('States.MathAdd'));
});

test('invalid config is rejected', () => {
  assert.throws(() => buildStateMachine({ ...config, iterationsPerExecution: 0 }), /iterationsPerExecution/);
  assert.throws(() => buildStateMachine({ ...config, subnets: [] }), /subnets/);
});
