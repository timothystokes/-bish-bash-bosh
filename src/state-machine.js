/**
 * @typedef {{
 *   clusterArn: string, taskDefinitionArn: string, subnets: string[], securityGroups: string[],
 *   containerName: string, readPointersFunctionArn: string, stateMachineArn: string,
 *   budgets: {maxCostUsd: number, maxIterations: number},
 *   iterationsPerExecution: number, pollSeconds: number,
 * }} StateMachineConfig
 */

/**
 * @param {StateMachineConfig} c
 */
function validate(c) {
  for (const k of ['clusterArn', 'taskDefinitionArn', 'containerName', 'readPointersFunctionArn', 'stateMachineArn']) {
    if (typeof c[/** @type {keyof StateMachineConfig} */ (k)] !== 'string' || c[/** @type {keyof StateMachineConfig} */ (k)] === '') throw new Error(`${k} must be a non-empty string`);
  }
  for (const k of /** @type {const} */ (['subnets', 'securityGroups'])) {
    if (!Array.isArray(c[k]) || c[k].length === 0) throw new Error(`${k} must be a non-empty array`);
  }
  const positive = (/** @type {string} */ k, /** @type {unknown} */ v) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`${k} must be a positive number`);
  };
  positive('maxCostUsd', c.budgets?.maxCostUsd);
  positive('maxIterations', c.budgets?.maxIterations);
  positive('iterationsPerExecution', c.iterationsPerExecution);
  positive('pollSeconds', c.pollSeconds);
}

/**
 * Builds the Amazon States Language definition that loops `hodgepodge step`, one Fargate Spot
 * task per iteration. The execution context holds pointers only (`$.pointers`: sha,
 * iteration, cost, status, paused, stop), re-read from git and run records each loop.
 * Input: `{runId, executionIterations: 0}`.
 * @param {StateMachineConfig} config
 * @returns {Record<string, any>}
 */
export function buildStateMachine(config) {
  validate(config);
  const { budgets } = config;
  return {
    Comment: 'hodge loop: one hodgepodge step per Fargate Spot task',
    StartAt: 'ReadPointers',
    States: {
      ReadPointers: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: { FunctionName: config.readPointersFunctionArn, 'Payload.$': '$' },
        ResultSelector: { 'sha.$': '$.Payload.sha', 'iteration.$': '$.Payload.iteration', 'cost.$': '$.Payload.cost', 'status.$': '$.Payload.status', 'paused.$': '$.Payload.paused', 'stop.$': '$.Payload.stop' },
        ResultPath: '$.pointers',
        Next: 'Decide',
      },
      Decide: {
        Type: 'Choice',
        Choices: [
          { Variable: '$.pointers.stop', BooleanEquals: true, Next: 'Stopped' },
          { Variable: '$.pointers.paused', BooleanEquals: true, Next: 'WaitWhilePaused' },
          { Variable: '$.pointers.status', StringEquals: 'done', Next: 'Done' },
          {
            Or: [
              { Variable: '$.pointers.status', StringEquals: 'gated' },
              { Variable: '$.pointers.status', StringEquals: 'over-budget' },
            ],
            Next: 'Halted',
          },
          {
            Or: [
              { Variable: '$.pointers.cost', NumericGreaterThanEquals: budgets.maxCostUsd },
              { Variable: '$.pointers.iteration', NumericGreaterThanEquals: budgets.maxIterations },
            ],
            Next: 'BudgetExhausted',
          },
          { Variable: '$.executionIterations', NumericGreaterThanEquals: config.iterationsPerExecution, Next: 'StartSuccessor' },
        ],
        Default: 'CountIteration',
      },
      WaitWhilePaused: { Type: 'Wait', Seconds: config.pollSeconds, Next: 'ReadPointers' },
      CountIteration: {
        Type: 'Pass',
        Parameters: {
          'runId.$': '$.runId',
          'pointers.$': '$.pointers',
          'executionIterations.$': 'States.MathAdd($.executionIterations, 1)',
        },
        Next: 'RunStep',
      },
      RunStep: {
        Type: 'Task',
        Resource: 'arn:aws:states:::ecs:runTask.sync',
        Parameters: {
          Cluster: config.clusterArn,
          TaskDefinition: config.taskDefinitionArn,
          CapacityProviderStrategy: [{ CapacityProvider: 'FARGATE_SPOT', Weight: 1 }],
          NetworkConfiguration: { AwsvpcConfiguration: { Subnets: config.subnets, SecurityGroups: config.securityGroups, AssignPublicIp: 'DISABLED' } },
          Overrides: {
            ContainerOverrides: [
              {
                Name: config.containerName,
                Command: ['step'],
                Environment: [
                  { Name: 'HODGE_RUN_ID', 'Value.$': '$.runId' },
                  { Name: 'HODGE_BASE_SHA', 'Value.$': '$.pointers.sha' },
                ],
              },
            ],
          },
        },
        ResultPath: '$.taskResult',
        Retry: [{ ErrorEquals: ['States.TaskFailed'], IntervalSeconds: 10, MaxAttempts: 2, BackoffRate: 2 }],
        Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.taskError', Next: 'ReadPointers' }],
        Next: 'ReadPointers',
      },
      StartSuccessor: {
        Type: 'Task',
        Resource: 'arn:aws:states:::states:startExecution',
        Parameters: {
          StateMachineArn: config.stateMachineArn,
          Input: { 'runId.$': '$.runId', 'pointers.$': '$.pointers', executionIterations: 0 },
        },
        ResultPath: null,
        Next: 'Handoff',
      },
      Handoff: { Type: 'Succeed' },
      Stopped: { Type: 'Succeed' },
      Done: { Type: 'Succeed' },
      BudgetExhausted: { Type: 'Succeed' },
      Halted: { Type: 'Fail', Error: 'HodgeHalted', Cause: 'last step was gated or over budget' },
    },
  };
}
