import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrap } from './customer-app-bootstrap.mjs';

const config = {
  profile: 'test', account: '123456789012', region: 'us-east-2', organization: 'example-org',
  appName: 'Example customer test', homepage: 'https://example.com', path: '/repo-runner/customer-test',
  webhookUrl: 'https://example.execute-api.us-east-2.amazonaws.com/webhook',
};
const app = {
  id: 123, slug: 'example-test', owner: { login: config.organization },
  pem: '-----BEGIN RSA PRIVATE KEY-----\nsynthetic', webhook_secret: 'synthetic',
};

test('local GitHub callback checks state and writes to the verified customer account', async () => {
  const writes = [];
  let accountChecks = 0;
  let exchangeCalls = 0;
  let announce;
  const ready = new Promise((resolve) => { announce = resolve; });
  const pending = bootstrap(config, {
    announce, timeoutMs: 5000,
    aws: {
      async account() {
        accountChecks++;
        return config.account;
      },
      async hasAppParameters() { return false; },
      async putParameter(input) { writes.push(input); },
    },
    request: async () => {
      exchangeCalls++;
      return Response.json(app);
    },
  });
  const setup = await ready;
  const form = await fetch(setup);
  assert.equal(form.status, 200);
  const html = await form.text();
  const manifest = JSON.parse(html.match(/name="manifest" value="([^"]+)"/)[1].replaceAll('&quot;', '"'));
  assert.deepEqual(manifest.hook_attributes, { url: config.webhookUrl, active: true });
  assert.deepEqual(manifest.default_events, ['workflow_job']);
  const state = html.match(/state=([a-f0-9]{64})/)[1];
  const callback = new URL('/callback?code=example', setup);
  assert.equal((await fetch(callback)).status, 404);
  callback.searchParams.set('state', state);
  const response = await fetch(callback);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes(app.webhook_secret), false);
  assert.deepEqual(await pending, { appId: 123, slug: app.slug });
  assert.equal(accountChecks, 2);
  assert.equal(exchangeCalls, 1);
  assert.deepEqual(writes.map(({ Name, Type, Overwrite }) => [Name, Type, Overwrite]), [
    [config.path + '/app-key-base64', 'SecureString', false],
    [config.path + '/webhook-secret', 'SecureString', false],
    [config.path + '/app-id', 'String', false],
  ]);
});

test('wrong account or occupied parameter path stops before GitHub', async () => {
  const announce = () => assert.fail('No browser setup URL should be issued');
  await assert.rejects(bootstrap(config, { aws: { account: async () => '999999999999' }, announce }), /different account/);
  await assert.rejects(bootstrap(config, {
    announce,
    aws: { account: async () => config.account, hasAppParameters: async () => true },
  }), /parameter path is in use/);
});

test('customer bootstrap refuses an unrelated webhook destination before AWS or GitHub', async () => {
  for (const webhookUrl of [
    'http://example.execute-api.us-east-2.amazonaws.com/webhook',
    'https://example.execute-api.us-west-2.amazonaws.com/webhook',
    'https://example.com/webhook',
    'https://example.execute-api.us-east-2.amazonaws.com/webhook?extra=1',
  ]) {
    await assert.rejects(bootstrap({ ...config, webhookUrl }, {
      aws: { account: () => assert.fail('AWS should not be called') },
    }), /Use the HTTPS webhook endpoint/);
  }
});
