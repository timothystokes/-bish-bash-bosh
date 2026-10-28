import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { HodgeStack } from '../infra/stack.js';

const props = {
  env: { account: '111111111111', region: 'ap-southeast-2' },
  budgets: { maxIterations: 100 },
  iterationsPerExecution: 20,
  pollSeconds: 30,
  secretNames: ['hodge/agent-key'],
};

function synth() {
  const stack = new HodgeStack(new App(), 'Hodge', props);
  return Template.fromStack(stack);
}

test('creates ECR repo, cluster, Fargate task definition and artifacts bucket', () => {
  const t = synth();
  t.resourceCountIs('AWS::ECR::Repository', 1);
  t.resourceCountIs('AWS::ECS::Cluster', 1);
  t.hasResourceProperties('AWS::ECS::TaskDefinition', { RequiresCompatibilities: ['FARGATE'], ContainerDefinitions: [Match.objectLike({ Name: 'hodge' })] });
  t.hasResourceProperties('AWS::S3::Bucket', { PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true, RestrictPublicBuckets: true }), VersioningConfiguration: { Status: 'Enabled' } });
});

test('cluster enables FARGATE_SPOT', () => {
  synth().hasResourceProperties('AWS::ECS::ClusterCapacityProviderAssociations', { CapacityProviders: Match.arrayWith(['FARGATE_SPOT']) });
});

test('secrets are referenced from Secrets Manager, never inlined', () => {
  const t = synth();
  const json = JSON.stringify(t.toJSON());
  t.hasResourceProperties('AWS::ECS::TaskDefinition', { ContainerDefinitions: [Match.objectLike({ Secrets: [Match.objectLike({ Name: 'HODGE_SECRET_AGENT_KEY' })] })] });
  assert.match(json, /hodge\/agent-key/);
});

test('ReadPointers lambda wraps rebuildPointers and mounts the shared repo volume', () => {
  const t = synth();
  t.hasResourceProperties('AWS::Lambda::Function', { Handler: 'src/read-pointers-handler.handler', Runtime: 'nodejs22.x', FileSystemConfigs: [Match.objectLike({ LocalMountPath: '/mnt/work' })] });
  t.resourceCountIs('AWS::EFS::FileSystem', 1);
});

test('state machine is the buildStateMachine definition, referencing lambda, task and itself by name', () => {
  const t = synth();
  t.hasResourceProperties('AWS::StepFunctions::StateMachine', { StateMachineName: 'hodge-loop', DefinitionString: Match.anyValue() });
  const sm = Object.values(t.findResources('AWS::StepFunctions::StateMachine'))[0];
  const text = JSON.stringify(sm.Properties.DefinitionString);
  for (const s of ['ReadPointers', 'RunStep', 'FARGATE_SPOT', 'arn:aws:states:::ecs:runTask.sync', 'stateMachine:hodge-loop']) assert.ok(text.includes(s), s);
});

test('state machine role may run tasks, invoke the lambda and stop executions', () => {
  const json = JSON.stringify(synth().findResources('AWS::IAM::Policy'));
  for (const a of ['ecs:RunTask', 'ecs:StopTask', 'lambda:InvokeFunction', 'states:StartExecution', 'iam:PassRole']) assert.ok(json.includes(a), a);
});

test('synth is deterministic', () => {
  assert.deepEqual(synth().toJSON(), synth().toJSON());
});

test('rejects invalid budgets', () => {
  assert.throws(() => new HodgeStack(new App(), 'Bad', { ...props, budgets: { maxIterations: 0 } }), /maxIterations/);
});
