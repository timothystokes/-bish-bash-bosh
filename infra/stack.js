import { ArnFormat, CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sm from 'aws-cdk-lib/aws-secretsmanager';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { buildStateMachine } from '../src/state-machine.js';

const CONTAINER = 'hodge';
const STATE_MACHINE_NAME = 'hodge-loop';
const MOUNT = '/mnt/work';

/**
 * @typedef {import('aws-cdk-lib').StackProps & {
 *   budgets: {maxIterations: number},
 *   iterationsPerExecution: number,
 *   pollSeconds: number,
 *   secretNames?: string[],
 * }} HodgeStackProps
 */

export class HodgeStack extends Stack {
  /**
   * @param {import('constructs').Construct} scope
   * @param {string} id
   * @param {HodgeStackProps} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);
    const { budgets, iterationsPerExecution, pollSeconds, secretNames = [], ...stackProps } = props;
    void stackProps;

    const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2, natGateways: 1 });
    const securityGroup = new ec2.SecurityGroup(this, 'TaskSg', { vpc });

    const repository = new ecr.Repository(this, 'Image', { removalPolicy: RemovalPolicy.RETAIN, imageScanOnPush: true });
    const artifacts = new s3.Bucket(this, 'Artifacts', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // The target repo checkout lives on a shared volume so the light lambda and the step tasks see the same git state.
    const fileSystem = new efs.FileSystem(this, 'Work', { vpc, encrypted: true, removalPolicy: RemovalPolicy.RETAIN, securityGroup });
    const accessPoint = fileSystem.addAccessPoint('WorkAp', {
      path: '/work',
      posixUser: { uid: '1000', gid: '1000' },
      createAcl: { ownerUid: '1000', ownerGid: '1000', permissions: '755' },
    });

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, enableFargateCapacityProviders: true });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'Task', { cpu: 1024, memoryLimitMiB: 4096 });
    taskDefinition.addVolume({
      name: 'work',
      efsVolumeConfiguration: { fileSystemId: fileSystem.fileSystemId, transitEncryption: 'ENABLED', authorizationConfig: { accessPointId: accessPoint.accessPointId, iam: 'ENABLED' } },
    });
    fileSystem.grantRootAccess(taskDefinition.taskRole);
    /** @type {Record<string, ecs.Secret>} */
    const secrets = {};
    for (const name of secretNames) {
      const secret = sm.Secret.fromSecretNameV2(this, `Secret-${name}`, name);
      secrets[`HODGE_SECRET_${name.split('/').pop()?.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] = ecs.Secret.fromSecretsManager(secret);
    }
    const container = taskDefinition.addContainer(CONTAINER, {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'hodge' }),
      environment: { HODGE_ARTIFACTS_BUCKET: artifacts.bucketName },
      secrets,
    });
    container.addMountPoints({ containerPath: '/work', sourceVolume: 'work', readOnly: false });
    artifacts.grantReadWrite(taskDefinition.taskRole);

    const readPointers = new lambda.Function(this, 'ReadPointers', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'src/read-pointers-handler.handler',
      code: lambda.Code.fromAsset('.', { exclude: ['*', '!src', '!src/**', '!package.json'] }),
      timeout: Duration.seconds(30),
      vpc,
      securityGroups: [securityGroup],
      filesystem: lambda.FileSystem.fromEfsAccessPoint(accessPoint, MOUNT),
      environment: { HODGE_REPO_DIR: MOUNT },
    });

    const stateMachineArn = this.formatArn({ service: 'states', resource: 'stateMachine', resourceName: STATE_MACHINE_NAME, arnFormat: ArnFormat.COLON_RESOURCE_NAME });
    const definition = buildStateMachine({
      clusterArn: cluster.clusterArn,
      taskDefinitionArn: taskDefinition.taskDefinitionArn,
      subnets: vpc.privateSubnets.map((s) => s.subnetId),
      securityGroups: [securityGroup.securityGroupId],
      containerName: CONTAINER,
      readPointersFunctionArn: readPointers.functionArn,
      stateMachineArn,
      budgets,
      iterationsPerExecution,
      pollSeconds,
    });

    const role = new iam.Role(this, 'StateMachineRole', { assumedBy: new iam.ServicePrincipal('states.amazonaws.com') });
    readPointers.grantInvoke(role);
    role.addToPolicy(new iam.PolicyStatement({ actions: ['ecs:RunTask'], resources: [taskDefinition.taskDefinitionArn] }));
    role.addToPolicy(new iam.PolicyStatement({ actions: ['ecs:StopTask', 'ecs:DescribeTasks'], resources: ['*'] }));
    role.addToPolicy(new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [taskDefinition.taskRole.roleArn, taskDefinition.executionRole?.roleArn ?? taskDefinition.taskRole.roleArn] }));
    role.addToPolicy(new iam.PolicyStatement({ actions: ['states:StartExecution'], resources: [stateMachineArn] }));
    // Required for `.sync` integrations (managed rule that watches the ECS task).
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['events:PutTargets', 'events:PutRule', 'events:DescribeRule'],
      resources: [this.formatArn({ service: 'events', resource: 'rule', resourceName: 'StepFunctionsGetEventsForECSTaskRule' })],
    }));

    const machine = new sfn.CfnStateMachine(this, 'Loop', {
      stateMachineName: STATE_MACHINE_NAME,
      roleArn: role.roleArn,
      definitionString: this.toJsonString(definition),
    });
    machine.node.addDependency(role);

    new CfnOutput(this, 'RepositoryUri', { value: repository.repositoryUri });
    new CfnOutput(this, 'ArtifactsBucket', { value: artifacts.bucketName });
    new CfnOutput(this, 'StateMachineArn', { value: stateMachineArn });
  }
}
