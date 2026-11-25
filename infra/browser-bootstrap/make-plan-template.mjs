import { readFileSync } from 'node:fs';

const template = JSON.parse(readFileSync(new URL('./proof.json', import.meta.url)));
const ref = (name) => ({ Ref: name });
const sub = (value) => ({ 'Fn::Sub': value });
const parameter = (AllowedPattern) => ({ Type: 'String', AllowedPattern });

template.Description = 'Generate a create-only Repo Runner Terraform preview inside the customer AWS account.';
Object.assign(template.Parameters, {
  SourceBucket: parameter('[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]'),
  SourceKey: parameter('browser-bootstrap/[A-Za-z0-9/_-]+[.]zip'),
  SourceVersion: parameter('[A-Za-z0-9._/+=-]{1,1024}'),
  Repository: parameter('[A-Za-z0-9-]+/[A-Za-z0-9_.-]+'),
  PilotPrefix: parameter('[a-z0-9][a-z0-9-]{1,23}'),
  VpcId: parameter('vpc-[a-f0-9]+'),
  SubnetIds: parameter('subnet-[a-f0-9]+(,subnet-[a-f0-9]+)*'),
});

const build = template.Resources.Build.Properties;
build.Source = { Type: 'S3', Location: sub('${SourceBucket}/${SourceKey}') };
build.SourceVersion = ref('SourceVersion');
build.TimeoutInMinutes = 10;
for (const [Name, parameterName] of Object.entries({
  PILOT_REPOSITORY: 'Repository', PILOT_PREFIX: 'PilotPrefix', PILOT_VPC: 'VpcId', PILOT_SUBNETS: 'SubnetIds',
})) {
  build.Environment.EnvironmentVariables.push({ Name, Value: ref(parameterName) });
}

template.Resources.BuildRole.Properties.Policies[0].PolicyDocument.Statement.push(
  { Effect: 'Allow', Action: 's3:GetBucketLocation', Resource: sub('arn:${AWS::Partition}:s3:::${SourceBucket}') },
  { Effect: 'Allow', Action: ['s3:GetObject', 's3:GetObjectVersion'],
    Resource: sub('arn:${AWS::Partition}:s3:::${SourceBucket}/${SourceKey}') },
  { Effect: 'Allow', Action: ['ec2:DescribeImages', 'ec2:DescribeSubnets'], Resource: '*' },
);

console.log(JSON.stringify(template, null, 2));
