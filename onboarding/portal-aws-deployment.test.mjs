import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awsDeploymentLink, customerRegistrationOrigin } from '../portal/aws-deployment.mjs';

const deployment = {
  account: '123456789012', region: 'us-east-2', bucket: 'example-private-bucket',
  templateKey: 'browser-bootstrap/sandbox-1/combined.json',
  stackName: 'rr-browser-sandbox', repository: 'example-org/repo-runner-test',
};

test('opens Quick Create for the fixed private template and stack', () => {
  const url = new URL(awsDeploymentLink(deployment));
  assert.equal(url.origin, 'https://us-east-2.console.aws.amazon.com');
  assert.equal(url.pathname, '/cloudformation/home');
  assert.equal(url.searchParams.get('region'), 'us-east-2');
  const [path, search] = url.hash.split('?');
  assert.equal(path, '#/stacks/create/review');
  const params = new URLSearchParams(search);
  assert.deepEqual([...params.keys()], ['templateURL', 'stackName']);
  assert.equal(params.get('stackName'), deployment.stackName);
  assert.equal(params.get('templateURL'),
    'https://example-private-bucket.s3.us-east-2.amazonaws.com/browser-bootstrap/sandbox-1/combined.json');
});

test('rejects untrusted URL fragments and invalid sandbox identifiers', () => {
  for (const fields of [
    { region: 'evil.example' }, { templateKey: 'browser-bootstrap/x/../combined.json' },
    { templateKey: 'browser-bootstrap/x/combined.json?token=fixture' }, { stackName: 'rr-foo#extra' },
    { bucket: 'example.com' }, { account: 'fixture' }, { repository: 'https://example.test/repo' },
  ]) assert.throws(() => awsDeploymentLink({ ...deployment, ...fields }), /invalid/);
});

test('uses only a regional HTTPS API origin for the customer registration token', () => {
  const value = 'https://fixture.execute-api.us-east-2.amazonaws.com';
  assert.equal(customerRegistrationOrigin(value, 'us-east-2'), value);
  for (const bad of [value + '/extra', value + '?x=1', value.replace('us-east-2','us-west-2'), 'https://example.test']) {
    assert.throws(() => customerRegistrationOrigin(bad, 'us-east-2'), /invalid/);
  }
});
