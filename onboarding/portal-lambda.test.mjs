import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPortalLambda } from './portal-lambda.mjs';

const portalOrigin = 'https://portal.example.test';
const sandbox = { issuer: 'https://identity.example.test', subject: 'owner', tenantId: 'sandbox',
  installation: { destination: { accountId: '111111111111' } } };
const config = { portalOrigin, sandbox };

function event(route, method, claims = { iss: sandbox.issuer, sub: sandbox.subject }) {
  return { version: '2.0', rawPath: `/api/onboarding/github/${route}`, headers: { origin: portalOrigin },
    requestContext: { http: { method }, authorizer: { jwt: { claims } } } };
}

test('requires gateway-verified issuer and subject before initializing AWS', async () => {
  const connect = test.mock.fn();
  const handler = createPortalLambda(config, connect);
  const forged = event('start', 'POST', {});
  forged.headers.authorization = 'Bearer synthetic';
  assert.equal((await handler(forged)).statusCode, 403);
  assert.equal((await handler(event('start', 'POST', { iss: 'https://wrong.test', sub: 'owner' }))).statusCode, 403);
  assert.equal((await handler(event('unknown', 'GET'))).statusCode, 404);
  assert.equal((await handler(event('start', 'GET'))).statusCode, 405);
  assert.equal(connect.mock.callCount(), 0);
});

test('mounts both handlers with server-approved context and forwards duplicate query values', async () => {
  const connect = test.mock.fn(async ({ authenticate, approvedInstallation }) => {
    assert.deepEqual(await authenticate(), { tenantId: 'sandbox', userId: 'owner' });
    assert.deepEqual(await approvedInstallation(), sandbox.installation);
    return {
      start: async (request) => Response.json({ origin: request.headers.get('origin') }),
      callback: async (request) => {
        assert.deepEqual(new URL(request.url).searchParams.getAll('code'), ['first', 'duplicate']);
        return Response.json({ error: 'refused' }, { status: 409, headers: { 'cache-control': 'no-store' } });
      },
    };
  });
  const handler = createPortalLambda(config, connect);
  assert.deepEqual(JSON.parse((await handler(event('start', 'POST'))).body), { origin: portalOrigin });
  const callback = await handler({ ...event('callback', 'GET'), rawQueryString: 'code=first&code=duplicate' });
  assert.equal(callback.statusCode, 409);
  assert.equal(callback.headers['cache-control'], 'no-store');
  assert.equal(connect.mock.callCount(), 1);
});

test('redacts initialization errors and allows a later request to retry', async () => {
  let calls = 0;
  const handler = createPortalLambda(config, async () => {
    if (++calls === 1) throw new Error('synthetic AWS details');
    return { start: async () => Response.json({ ready: true }) };
  });
  const first = await handler(event('start', 'POST'));
  assert.equal(first.statusCode, 503);
  assert.doesNotMatch(first.body, /synthetic AWS details/);
  assert.equal((await handler(event('start', 'POST'))).statusCode, 200);
});
