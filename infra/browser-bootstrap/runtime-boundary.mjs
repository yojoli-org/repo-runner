import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  account: { type: 'string' }, region: { type: 'string' }, prefix: { type: 'string' },
} });
const { account, region, prefix } = values;
if (!/^\d{12}$/.test(account ?? '') || !/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region ?? '')
  || !/^[a-z0-9][a-z0-9-]{1,23}$/.test(prefix ?? '')) {
  throw new Error('Provide --account, --region, and the exact --prefix for an isolated runner pool.');
}

const regional = (service, resource) => `arn:aws:${service}:${region}:${account}:${resource}`;
const allow = (Action, Resource, Condition) => ({
  Effect: 'Allow', Action, Resource, ...(Condition && { Condition }),
});
const sameRegion = { StringEquals: { 'aws:RequestedRegion': region } };
const config = regional('ssm', `parameter/github-action-runners/${prefix}/*`);
const app = regional('ssm', `parameter/repo-runner/${prefix}/*`);
const objects = `arn:aws:s3:::${prefix}-dist-*/*`;
const instance = regional('ec2', 'instance/*');
const policy = { Version: '2012-10-17', Statement: [
  allow(['ec2:DescribeInstances', 'ec2:DescribeLaunchTemplateVersions', 'ec2:DescribeTags', 'ec2:DescribeVolumes'],
    '*', sameRegion),
  allow(['ec2:RunInstances', 'ec2:CreateFleet'], '*', sameRegion),
  allow('ec2:CreateTags', [
    regional('ec2', 'instance/*'), regional('ec2', 'volume/*'), regional('ec2', 'fleet/*'),
    regional('ec2', 'network-interface/*'),
  ], { StringEquals: { 'ec2:CreateAction': ['RunInstances', 'CreateFleet'] } }),
  allow(['ec2:CreateTags', 'ec2:DeleteTags', 'ec2:TerminateInstances'], instance,
    { StringEquals: { 'ec2:ResourceTag/ghr:environment': prefix } }),
  allow('iam:PassRole', `arn:aws:iam::${account}:role/${prefix}/${prefix}-runner-*`,
    { StringEquals: { 'iam:PassedToService': 'ec2.amazonaws.com' } }),
  allow(['ssm:GetParameter', 'ssm:GetParameters'], [config, app]),
  allow(['ssm:GetParametersByPath', 'ssm:PutParameter', 'ssm:AddTagsToResource', 'ssm:DeleteParameter', 'ssm:DeleteParameters'],
    config),
  allow(['s3:GetObject', 's3:GetObjectAcl', 's3:GetObjectTagging', 's3:GetObjectVersionTagging',
    's3:PutObject', 's3:PutObjectTagging'], objects),
  allow(['sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
    regional('sqs', prefix + '-queued-builds')),
  allow('events:PutEvents', regional('events', 'event-bus/' + prefix + '-runners')),
  allow(['logs:CreateLogStream', 'logs:DescribeLogStreams', 'logs:PutLogEvents'],
    [regional('logs', 'log-group:/aws/lambda/' + prefix + '-*'),
      regional('logs', 'log-group:/github-self-hosted-runners/' + prefix + '/*')]),
  allow('logs:DescribeLogGroups', '*', sameRegion),
  allow('cloudwatch:PutMetricData', '*', sameRegion),
  allow(['kms:Decrypt', 'kms:GenerateDataKey'], regional('kms', 'key/*'), { StringEquals: {
    'kms:ViaService': [`ssm.${region}.amazonaws.com`, `sqs.${region}.amazonaws.com`],
  } }),
] };

console.log(JSON.stringify(policy, null, 2));
