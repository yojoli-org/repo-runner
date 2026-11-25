import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [file] = process.argv.slice(2);
if (!file || process.argv.length !== 3) throw new Error('Provide one deployment role settings JSON file.');
const { account, region, prefix, project, roleName, boundaryName, sourceBucket, sourceKey,
  sourceVersion, stateBucket, vpc } = JSON.parse(readFileSync(file, 'utf8'));
const bucketPattern = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
if (!/^\d{12}$/.test(account ?? '') || !/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region ?? '')
  || !/^[a-z0-9][a-z0-9-]{1,23}$/.test(prefix ?? '') || !/^rr-[a-z0-9-]{1,80}$/.test(project ?? '')
  || !/^rr-bootstrap-[A-Za-z0-9_-]{1,51}$/.test(roleName ?? '')
  || !/^rr-runtime-[A-Za-z0-9_-]{1,100}$/.test(boundaryName ?? '')
  || !bucketPattern.test(sourceBucket ?? '') || !bucketPattern.test(stateBucket ?? '')
  || !/^browser-bootstrap\/[A-Za-z0-9/_-]+[.]zip$/.test(sourceKey ?? '')
  || !/^[A-Za-z0-9._/+=-]{1,1024}$/.test(sourceVersion ?? '') || !/^vpc-[a-f0-9]+$/.test(vpc ?? '')) {
  throw new Error('Provide the exact account, region, project, pilot namespace, source version, state bucket, and VPC.');
}

function policyFrom(script, args) {
  const path = fileURLToPath(new URL(script, import.meta.url));
  return JSON.parse(execFileSync(process.execPath, [path, ...args], { encoding: 'utf8' }));
}

const runtime = policyFrom('./runtime-boundary.mjs', ['--account', account, '--region', region, '--prefix', prefix]);
const delegation = policyFrom('./deployment-iam.mjs', ['--account', account, '--prefix', prefix, '--boundary', boundaryName]);
const arn = (service, resource) => `arn:aws:${service}:${region}:${account}:${resource}`;
const allow = (Action, Resource, Condition) => ({ Effect: 'Allow', Action, Resource, ...(Condition && { Condition }) });
const stateKey = `browser-deploy/${prefix}/pilot.tfstate`;
const state = `arn:aws:s3:::${stateBucket}/${stateKey}`;
const source = `arn:aws:s3:::${sourceBucket}/${sourceKey}`;
const dist = `arn:aws:s3:::${prefix}-dist-*`;
const functions = arn('lambda', `function:${prefix}-*`);
const logGroups = [
  arn('logs', `log-group:/aws/lambda/${prefix}-*`),
  arn('logs', `log-group:/github-self-hosted-runners/${prefix}/*`),
];
const gateway = `arn:aws:apigateway:${region}::/apis`;
const apiTagPrefix = `arn:aws:apigateway:${region}::/tags/` +
  encodeURIComponent(`arn:aws:apigateway:${region}::/v2/apis/`);
const environmentTag = 'ghr:environment';
const requestTag = { StringEquals: { ['aws:RequestTag/' + environmentTag]: prefix } };
const resourceTag = { StringEquals: { ['aws:ResourceTag/' + environmentTag]: prefix } };

const deploy = { Version: '2012-10-17', Statement: [
  allow('s3:GetBucketLocation', [...new Set([sourceBucket, stateBucket])].map((bucket) => `arn:aws:s3:::${bucket}`)),
  allow('s3:GetObject', source),
  allow('s3:GetObjectVersion', source, { StringEquals: { 's3:VersionId': sourceVersion } }),
  allow(['s3:GetBucketVersioning', 's3:GetBucketPublicAccessBlock', 's3:GetEncryptionConfiguration'],
    `arn:aws:s3:::${stateBucket}`),
  allow('s3:ListBucket', `arn:aws:s3:::${stateBucket}`,
    { StringEquals: { 's3:prefix': [stateKey, stateKey + '.tflock', 'env:/'] } }),
  allow(['s3:GetObject', 's3:PutObject'], [state, state + '.tflock']),
  allow('s3:DeleteObject', state + '.tflock'),
  allow(['s3:CreateBucket', 's3:GetBucketLocation', 's3:GetBucketAcl', 's3:ListBucket', 's3:GetBucketTagging',
    's3:PutBucketTagging', 's3:GetBucketPolicy', 's3:PutBucketPolicy', 's3:GetBucketVersioning',
    's3:PutBucketVersioning', 's3:GetBucketPublicAccessBlock', 's3:PutBucketPublicAccessBlock',
    's3:GetEncryptionConfiguration', 's3:PutEncryptionConfiguration', 's3:GetLifecycleConfiguration',
    's3:PutLifecycleConfiguration', 's3:GetBucketNotification', 's3:PutBucketNotification',
    's3:GetBucketOwnershipControls', 's3:PutBucketOwnershipControls', 's3:GetBucketObjectLockConfiguration',
    's3:GetReplicationConfiguration', 's3:GetBucketCors', 's3:GetBucketLogging', 's3:GetBucketWebsite',
    's3:GetAccelerateConfiguration', 's3:GetBucketRequestPayment'], dist),
  allow(['s3:GetObject', 's3:PutObject', 's3:GetObjectTagging', 's3:PutObjectTagging'], dist + '/*'),
  allow(['logs:CreateLogStream', 'logs:PutLogEvents'], arn('logs', `log-group:/repo-runner/bootstrap/${project}:*`)),
  allow(['logs:CreateLogGroup', 'logs:PutRetentionPolicy', 'logs:TagResource', 'logs:ListTagsForResource'], logGroups),
  allow(['logs:DescribeLogGroups', 'lambda:GetAccountSettings', 'ec2:DescribeImages', 'ec2:DescribeSubnets',
    'ec2:DescribeSecurityGroups', 'ec2:DescribeSecurityGroupRules', 'ec2:DescribeLaunchTemplates',
    'ec2:DescribeLaunchTemplateVersions', 'ssm:DescribeParameters'], '*', { StringEquals: { 'aws:RequestedRegion': region } }),
  allow('ec2:CreateSecurityGroup', arn('ec2', 'vpc/' + vpc)),
  allow('ec2:CreateSecurityGroup', arn('ec2', 'security-group/*'), requestTag),
  allow('ec2:CreateLaunchTemplate', arn('ec2', 'launch-template/*'), requestTag),
  allow('ec2:CreateTags', [arn('ec2', 'security-group/*'), arn('ec2', 'launch-template/*')],
    { StringEquals: { 'ec2:CreateAction': ['CreateSecurityGroup', 'CreateLaunchTemplate'],
      ['aws:RequestTag/' + environmentTag]: prefix } }),
  allow(['ec2:AuthorizeSecurityGroupEgress', 'ec2:RevokeSecurityGroupEgress'], arn('ec2', 'security-group/*'), resourceTag),
  allow(['lambda:CreateFunction', 'lambda:GetFunction', 'lambda:GetFunctionConfiguration', 'lambda:GetPolicy',
    'lambda:GetFunctionConcurrency', 'lambda:PutFunctionConcurrency', 'lambda:ListVersionsByFunction',
    'lambda:GetFunctionCodeSigningConfig', 'lambda:ListTags', 'lambda:TagResource'], functions),
  allow('lambda:AddPermission', functions, { StringEquals: {
    'lambda:Principal': ['events.amazonaws.com', 'apigateway.amazonaws.com', 's3.amazonaws.com', 'sqs.amazonaws.com'],
  } }),
  allow('lambda:CreateEventSourceMapping', '*', { ArnLike: { 'lambda:FunctionArn': functions } }),
  allow(['lambda:GetEventSourceMapping', 'lambda:TagResource', 'lambda:ListTags'],
    arn('lambda', 'event-source-mapping:*')),
  allow(['events:CreateEventBus', 'events:DescribeEventBus', 'events:CreateArchive', 'events:DescribeArchive',
    'events:PutRule', 'events:DescribeRule', 'events:PutTargets', 'events:ListTargetsByRule',
    'events:TagResource', 'events:ListTagsForResource'],
  [arn('events', 'event-bus/' + prefix + '-*'), arn('events', 'archive/' + prefix + '-*'),
    arn('events', 'rule/' + prefix + '-*')]),
  allow(['sqs:CreateQueue', 'sqs:GetQueueUrl', 'sqs:GetQueueAttributes', 'sqs:SetQueueAttributes',
    'sqs:ListQueueTags', 'sqs:TagQueue'], arn('sqs', prefix + '-queued-builds')),
  allow(['ssm:PutParameter', 'ssm:GetParameter', 'ssm:ListTagsForResource', 'ssm:AddTagsToResource'],
    arn('ssm', `parameter/github-action-runners/${prefix}/*`)),
  allow('ssm:GetParameters', arn('ssm', `parameter/github-action-runners/${prefix}/runners/config/ami_id`)),
  allow('apigateway:POST', gateway, requestTag),
  // API Gateway checks the encoded tag resource when creating a tagged HTTP API.
  allow('apigateway:POST', apiTagPrefix + '*'),
  allow('apigateway:POST', ['integrations', 'routes', 'stages'].map((child) => `${gateway}/*/${child}`)),
  allow('apigateway:GET', [gateway + '/*', `arn:aws:apigateway:${region}::/tags/*`]),
] };

const template = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Customer-owned IAM prerequisites for one isolated Repo Runner browser deployment.',
  Conditions: {
    ApprovedDestination: { 'Fn::And': [
      { 'Fn::Equals': [{ Ref: 'AWS::AccountId' }, account] },
      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, region] },
    ] },
  },
  Resources: {
    RuntimeBoundary: { Type: 'AWS::IAM::ManagedPolicy', Condition: 'ApprovedDestination', Properties: {
      ManagedPolicyName: boundaryName, PolicyDocument: runtime,
    } },
    DeploymentRole: { Type: 'AWS::IAM::Role', Condition: 'ApprovedDestination', Properties: {
      RoleName: roleName,
      AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{
        Effect: 'Allow', Principal: { Service: 'codebuild.amazonaws.com' }, Action: 'sts:AssumeRole',
        Condition: { StringEquals: {
          'aws:SourceAccount': account, 'aws:SourceArn': arn('codebuild', 'project/' + project),
        } },
      }] },
      Policies: [
        { PolicyName: 'PilotIamDelegation', PolicyDocument: delegation },
        { PolicyName: 'PilotDeployment', PolicyDocument: deploy },
      ],
    }, DependsOn: 'RuntimeBoundary' },
  },
  Outputs: {
    DeploymentRoleName: { Condition: 'ApprovedDestination', Value: { Ref: 'DeploymentRole' } },
    RuntimeBoundaryName: { Condition: 'ApprovedDestination', Value: boundaryName },
  },
};
console.log(JSON.stringify(template, null, 2));
