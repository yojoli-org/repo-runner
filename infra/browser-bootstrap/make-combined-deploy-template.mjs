import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [file] = process.argv.slice(2);
if (process.argv.length !== 3) throw new Error('Provide the approved deployment settings JSON file.');
const settings = JSON.parse(readFileSync(file, 'utf8'));
const { account, region, project, roleName, boundaryName, sourceBucket, sourceKey, sourceVersion,
  stateBucket, prefix, repository, vpc, subnets } = settings;
if (!Array.isArray(subnets) || subnets.length === 0 || new Set(subnets).size !== subnets.length) {
  throw new Error('Provide the unique subnet IDs for the approved VPC.');
}

function generate(script, ...args) {
  const path = fileURLToPath(new URL(script, import.meta.url));
  return JSON.parse(execFileSync(process.execPath, [path, ...args], { encoding: 'utf8' }));
}

const deploy = generate('./make-plan-template.mjs', '--deploy');
const iam = generate('./make-deployment-role-template.mjs', file);
const approved = {
  ExpectedAccountId: account, SourceBucket: sourceBucket, SourceKey: sourceKey, SourceVersion: sourceVersion,
  Repository: repository, PilotPrefix: prefix, VpcId: vpc, SubnetIds: subnets.join(','),
  DeploymentRoleName: roleName, StateBucket: stateBucket, RuntimeBoundaryName: boundaryName,
};
for (const [name, spec] of Object.entries(deploy.Parameters)) {
  const value = approved[name];
  if (typeof value !== 'string' || !new RegExp(`^(?:${spec.AllowedPattern})$`).test(value)) {
    throw new Error(`Provide a valid deployment setting for ${name}.`);
  }
}

function bind(node) {
  if (Array.isArray(node)) return node.map(bind);
  if (node === null || typeof node !== 'object') return node;
  if (typeof node.Ref === 'string' && Object.hasOwn(approved, node.Ref)) return approved[node.Ref];
  if (typeof node['Fn::Sub'] === 'string') {
    return { 'Fn::Sub': node['Fn::Sub'].replaceAll(/\$\{([^}]+)\}/g, (part, name) => approved[name] ?? part) };
  }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, bind(value)]));
}

const resources = { ...iam.Resources, ...bind(deploy.Resources) };
resources.Build.Properties.ServiceRole = { 'Fn::GetAtt': ['DeploymentRole', 'Arn'] };
for (const resource of Object.values(resources)) resource.Condition = 'ApprovedDeployment';

const outputs = { ...iam.Outputs, ...deploy.Outputs };
for (const output of Object.values(outputs)) output.Condition = 'ApprovedDeployment';

const template = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Create the scoped IAM roles and start one isolated Repo Runner deployment in the approved AWS account.',
  Conditions: {
    ApprovedDestination: iam.Conditions.ApprovedDestination,
    ApprovedDeployment: { 'Fn::And': [
      { Condition: 'ApprovedDestination' },
      { 'Fn::Equals': [{ Ref: 'AWS::StackName' }, project] },
    ] },
  },
  Resources: resources,
  Outputs: outputs,
};
console.log(JSON.stringify(template, null, 2));
