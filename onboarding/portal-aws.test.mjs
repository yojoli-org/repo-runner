import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAwsPortalHandlers, createCustomerAws } from './portal-aws.mjs';

const destination = { accountId: '111111111111', region: 'us-east-2', path: '/repo-runner/test',
  roleArn: 'arn:aws:iam::111111111111:role/repo-runner-test', externalId: 'synthetic-external-id' };

test('uses a short-lived customer session restricted to exact parameter names', async () => {
  const send = test.mock.fn(async () => ({ Credentials: { AccessKeyId: 'fake', SecretAccessKey: 'fake', SessionToken: 'fake' } }));
  const put = test.mock.fn();
  const customer = createCustomerAws({ portalSts: { send }, scopedSts: () => ({ send: async () => ({ Account: destination.accountId }) }),
    scopedSsm: (config) => {
      assert.equal(config.region, destination.region);
      assert.equal(config.credentials.sessionToken, 'fake');
      return { send: put };
    } });
  const client = await customer(destination);
  const [{ input }] = send.mock.calls[0].arguments;
  assert.equal(input.RoleArn, destination.roleArn);
  assert.equal(input.ExternalId, destination.externalId);
  assert.equal(input.DurationSeconds, 900);
  const [ssm, kms] = JSON.parse(input.Policy).Statement;
  assert.equal(ssm.Action, 'ssm:PutParameter');
  assert.deepEqual(ssm.Resource, ['app-key-base64', 'webhook-secret', 'app-id']
    .map((name) => `arn:aws:ssm:us-east-2:111111111111:parameter/repo-runner/test/${name}`));
  assert.equal(kms.Action, 'kms:Encrypt');
  assert.deepEqual(kms.Condition.StringEquals['kms:EncryptionContext:PARAMETER_ARN'], ssm.Resource.slice(0, 2));
  assert.equal((await client.getCallerIdentity()).Account, destination.accountId);
  assert.throws(() => client.putParameter({ Name: '/repo-runner/other/app-id', Overwrite: false }), /outside/);
  assert.throws(() => client.putParameter({ Name: `${destination.path}/app-id`, Overwrite: true }), /outside/);
  await client.putParameter({ Name: `${destination.path}/app-key-base64`, Type: 'String', Value: 'fixture', Overwrite: false });
  assert.equal(put.mock.callCount(), 1);
  assert.equal(put.mock.calls[0].arguments[0].input.Type, 'SecureString');
});

test('refuses an unapproved role account or invalid path before assuming a role', async () => {
  const send = test.mock.fn();
  const customer = createCustomerAws({ portalSts: { send } });
  await assert.rejects(customer({ ...destination, accountId: '222222222222' }), /Invalid/);
  await assert.rejects(customer({ ...destination, path: '/outside/test' }), /Invalid/);
  assert.equal(send.mock.callCount(), 0);
});

test('refuses a portal identity from the wrong account', async () => {
  await assert.rejects(createAwsPortalHandlers({ portalAccountId: '333333333333' }, {
    portalSts: { send: async () => ({ Account: '222222222222' }) },
  }), /portal account/);
});
