import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomerRegistrationLambda } from './customer-registration-lambda.mjs';

const origin = 'https://portal.example.test';
const issuer = 'https://login.example.test';
const account = '123456789012';
const webhook = 'https://sandbox.execute-api.us-east-2.amazonaws.com/webhook';
const config = {
  portalOrigin: origin, accountId: account, region: 'us-east-2', tableName: 'rr-test-attempts',
  sandbox: {
    prefix: 'rr-test', identity: { issuer, subject: 'approved-subject', tenantId: 'tenant-fixture' },
    app: { organization: 'example-org', appName: 'Repo Runner Test', homepage: origin,
      redirectUrl: origin + '/', webhookUrl: webhook },
  },
};

const event = (path, method, rawQueryString = '', sub = 'approved-subject') => ({
  version: '2.0', rawPath: '/api/onboarding/github/' + path, rawQueryString,
  headers: { origin }, requestContext: { http: { method }, authorizer: { jwt: { claims: { iss: issuer, sub } } } },
});

function fixture(awsAccount = account) {
  let attempt;
  const operations = [];
  const writes = [];
  const reports = [];
  const handler = createCustomerRegistrationLambda({ ...config, report: (step) => reports.push(step) }, {
    sts: { async send(command) {
      operations.push(command.constructor.name);
      assert.equal(command.constructor.name, 'GetCallerIdentityCommand');
      return { Account: awsAccount };
    } },
    document: { async send(command) {
      if (command.constructor.name === 'PutCommand') {
        attempt = command.input.Item;
        return {};
      }
      if (command.input.Key.id !== attempt?.id || attempt.claimedAt) {
        throw Object.assign(new Error(), { name: 'ConditionalCheckFailedException' });
      }
      attempt.claimedAt = 1;
      return { Attributes: attempt };
    } },
    ssm: { async send(command) { writes.push(command.input); } },
    request: async () => Response.json({
      id: 42, slug: 'example-test', owner: { login: 'example-org' },
      pem: '-----BEGIN RSA PRIVATE KEY-----\nsynthetic', webhook_secret: 'fixture-only',
    }),
  });
  return { handler, writes, operations, reports, hasAttempt: () => Boolean(attempt) };
}

test('HTTPS handoff exchanges GitHub approval and stores credentials using customer AWS identity only', async () => {
  const { handler, writes, operations, reports } = fixture();
  const start = await handler(event('start', 'POST'));
  assert.equal(start.statusCode, 200);
  const form = JSON.parse(start.body);
  const manifest = JSON.parse(form.fields.manifest);
  assert.deepEqual(manifest.hook_attributes, { active: true, url: webhook });
  assert.equal(manifest.redirect_url, origin + '/');
  const state = new URL(form.action).searchParams.get('state');
  const callback = event('callback', 'GET', `state=${state}&code=fixture&path=/repo-runner/other`);
  const result = await handler(callback);
  assert.deepEqual(JSON.parse(result.body), { appId: 42, slug: 'example-test' });
  assert.deepEqual(operations, ['GetCallerIdentityCommand', 'GetCallerIdentityCommand']);
  assert.ok(reports.includes('customer_account_verified'));
  assert.deepEqual(writes.map(({ Name, Type, Overwrite }) => [Name, Type, Overwrite]), [
    ['/repo-runner/rr-test/app-key-base64', 'SecureString', false],
    ['/repo-runner/rr-test/webhook-secret', 'SecureString', false],
    ['/repo-runner/rr-test/app-id', 'String', false],
  ]);
  assert.equal((await handler(callback)).statusCode, 409);
  assert.equal(writes.length, 3);
});

test('an unapproved subject and mismatched AWS account cannot create an attempt', async () => {
  const { handler, writes, operations, hasAttempt } = fixture('999999999999');
  assert.equal((await handler(event('start', 'POST', '', 'other-subject'))).statusCode, 403);
  assert.equal(operations.length, 0);
  assert.equal((await handler(event('start', 'POST'))).statusCode, 500);
  assert.equal(hasAttempt(), false);
  assert.deepEqual(writes, []);
});

test('rejects a webhook outside the installation region', () => {
  assert.throws(() => createCustomerRegistrationLambda({
    ...config, sandbox: { ...config.sandbox, app: { ...config.sandbox.app,
      webhookUrl: 'https://sandbox.execute-api.us-west-2.amazonaws.com/webhook' } },
  }), /customer webhook/);
});
