import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPortalRegistrationHandlers } from './portal-registration.mjs';

const portalOrigin = 'https://portal.example.test';
const destination = { accountId: '111111111111', region: 'us-east-2', path: '/repo-runner/example' };
const startRequest = (origin = portalOrigin) => new Request(`${portalOrigin}/start`, { method: 'POST', headers: { origin } });

function fixture({ signedIn = true, account = destination.accountId } = {}) {
  let item;
  const writes = [];
  const handlers = createPortalRegistrationHandlers({
    portalOrigin, tableName: 'portal-table',
    authenticate: async () => signedIn ? { tenantId: 'customer-a', userId: 'owner-a' } : null,
    approvedInstallation: async () => ({ destination, config: { organization: 'example-org',
      appName: 'Example Runner', homepage: portalOrigin, redirectUrl: `${portalOrigin}/callback` } }),
    dynamodb: {
      put: async ({ Item }) => { item = Item; },
      update: async ({ Key, ExpressionAttributeValues: values }) => {
        if (item?.id !== Key.id || item?.claimedAt || item?.tenantId !== values[':tenant']
          || item?.userId !== values[':user']) {
          throw Object.assign(new Error(), { name: 'ConditionalCheckFailedException' });
        }
        item.claimedAt = values[':now'];
        return { Attributes: item };
      },
    },
    request: async () => ({ ok: true, json: async () => ({ id: 123, slug: 'example-app',
      owner: { login: 'example-org' }, pem: '-----BEGIN RSA PRIVATE KEY-----\nfixture', webhook_secret: 'fixture' }) }),
    customerAws: async (approved) => {
      assert.deepEqual(approved, destination);
      return { getCallerIdentity: async () => ({ Account: account }), putParameter: async (input) => writes.push(input) };
    },
  });
  return { handlers, writes };
}

async function callbackRequest(handlers) {
  const start = await handlers.start(startRequest());
  assert.equal(start.status, 200);
  const { action } = await start.json();
  const state = new URL(action).searchParams.get('state');
  return new Request(`${portalOrigin}/callback?state=${state}&code=fixture&path=/repo-runner/other`);
}

test('authenticated handoff writes to the approved account and returns only App metadata', async () => {
  const { handlers, writes } = fixture();
  const callback = await callbackRequest(handlers);
  const response = await handlers.callback(callback);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.deepEqual(await response.json(), { appId: 123, slug: 'example-app' });
  assert.deepEqual(writes.map(({ Name }) => Name), ['app-key-base64', 'webhook-secret', 'app-id']
    .map((name) => `${destination.path}/${name}`));
  assert.equal((await handlers.callback(callback)).status, 409);
  assert.equal(writes.length, 3);
});

test('rejects cross-origin starts and unauthenticated requests', async () => {
  const { handlers } = fixture({ signedIn: false });
  assert.equal((await handlers.start(startRequest('https://other.example.test'))).status, 403);
  assert.equal((await handlers.start(startRequest())).status, 401);
  assert.equal((await handlers.callback(new Request(`${portalOrigin}/callback`))).status, 401);
});

test('a misdirected AWS client cannot write credentials', async () => {
  const { handlers, writes } = fixture({ account: '222222222222' });
  assert.equal((await handlers.callback(await callbackRequest(handlers))).status, 409);
  assert.deepEqual(writes, []);
});
