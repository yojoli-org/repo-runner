import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  account: { type: 'string' }, prefix: { type: 'string' }, boundary: { type: 'string' },
} });
const { account, prefix, boundary } = values;
if (!/^\d{12}$/.test(account ?? '') || !/^[a-z0-9][a-z0-9-]{1,23}$/.test(prefix ?? '')
  || !/^rr-runtime-[A-Za-z0-9_-]{1,100}$/.test(boundary ?? '')) {
  throw new Error('Provide --account, the exact --prefix, and the approved --boundary policy name.');
}

const iam = `arn:aws:iam::${account}:`;
const role = `${iam}role/${prefix}/${prefix}-*`;
const profile = `${iam}instance-profile/${prefix}/${prefix}-*`;
const policy = { Version: '2012-10-17', Statement: [
  { Effect: 'Allow', Action: 'iam:CreateRole', Resource: role, Condition: {
    StringEquals: { 'iam:PermissionsBoundary': iam + 'policy/' + boundary },
  } },
  { Effect: 'Allow', Action: ['iam:GetRole', 'iam:ListRoleTags', 'iam:TagRole',
    'iam:GetRolePolicy', 'iam:ListRolePolicies', 'iam:ListAttachedRolePolicies', 'iam:PutRolePolicy'], Resource: role },
  { Effect: 'Allow', Action: ['iam:CreateInstanceProfile', 'iam:GetInstanceProfile', 'iam:ListInstanceProfileTags',
    'iam:TagInstanceProfile', 'iam:AddRoleToInstanceProfile'], Resource: profile },
  { Effect: 'Allow', Action: 'iam:PassRole', Resource: role, Condition: {
    StringEquals: { 'iam:PassedToService': 'lambda.amazonaws.com' },
  } },
  { Effect: 'Allow', Action: 'iam:PassRole', Resource: `${iam}role/${prefix}/${prefix}-runner-*`, Condition: {
    StringEquals: { 'iam:PassedToService': 'ec2.amazonaws.com' },
  } },
  { Effect: 'Deny', Action: ['iam:DeleteRolePermissionsBoundary', 'iam:PutRolePermissionsBoundary'], Resource: role },
] };
console.log(JSON.stringify(policy, null, 2));
