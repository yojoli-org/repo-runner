import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAttemptStore, finishAppRegistration, startAppRegistration } from './registration-attempts.mjs';

const identity = { tenantId: 'tenant-a', userId: 'owner-a' };
const config = { organization: 'example-org', appName: 'Example Runner',
  homepage: 'https://example.test', redirectUrl: 'https://example.test/return' };
const destination = { accountId: '111111111111', region: 'us-east-2', path: '/repo-runner/test' };

test('stores only hashed state and claims it atomically within the same identity and expiry', async () => {
  const put = test.mock.fn();
  const update = test.mock.fn(async () => ({ Attributes: { destination } }));
  const store = createAttemptStore({ tableName: 'test', put, update, now: () => 1000 });
  const result = await startAppRegistration({ identity, config, destination, store });
  const state = new URL(result.action).searchParams.get('state');
  const [{ Item, ConditionExpression }] = put.mock.calls[0].arguments;
  assert.equal(ConditionExpression, 'attribute_not_exists(id)');
  assert.notEqual(Item.id, state);
  assert.equal(Item.state, undefined);
  assert.equal(Item.expiresAt, 1600);
  assert.equal(Item.organization, config.organization);
  assert.deepEqual(Item.destination, destination);
  assert.deepEqual(await store.claim({ state, ...identity }), { destination });
  const [claim] = update.mock.calls[0].arguments;
  assert.equal(claim.Key.id, Item.id);
  assert.equal(claim.ConditionExpression, 'tenantId = :tenant AND userId = :user AND expiresAt > :now AND attribute_not_exists(claimedAt)');
  assert.deepEqual(claim.ExpressionAttributeValues, { ':tenant': 'tenant-a', ':user': 'owner-a', ':now': 1000 });
});

test('refused or malformed callbacks never exchange a code', async () => {
  const update = test.mock.fn(async () => { throw Object.assign(new Error(), { name: 'ConditionalCheckFailedException' }); });
  const store = createAttemptStore({ tableName: 'test', update });
  const request = test.mock.fn();
  const query = new URLSearchParams({ state: 'a'.repeat(64), code: 'synthetic' });
  await assert.rejects(finishAppRegistration({ identity, store, query, request }), /expired or was already used/);
  query.append('state', 'duplicate');
  await assert.rejects(finishAppRegistration({ identity, store, query, request }), /Invalid/);
  assert.equal(update.mock.callCount(), 1);
  assert.equal(request.mock.callCount(), 0);
});

test('passes the stored AWS destination to the credential writer', async () => {
  const query = new URLSearchParams({ state: 'a'.repeat(64), code: 'synthetic', path: '/unexpected' });
  const result = await finishAppRegistration({ identity, query,
    store: { claim: async () => ({ organization: config.organization, destination }) },
    request: async () => ({ ok: true, json: async () => ({ id: 123, slug: 'test-app',
      owner: { login: config.organization }, pem: '-----BEGIN RSA PRIVATE KEY-----\nfixture', webhook_secret: 'fixture' }) }),
    saveCredentials: async (attempt) => assert.deepEqual(attempt.destination, destination),
  });
  assert.deepEqual(result, { appId: 123, slug: 'test-app' });
});
