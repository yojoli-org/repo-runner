import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completeRegistration } from './github-app-exchange.mjs';
import { saveAppParameters } from './parameter-store.mjs';

const attempt = { state: 'a'.repeat(64), organization: 'example-org' };
const query = new URLSearchParams({ state: attempt.state, code: 'fake-code' });
const app = {
  id: 123,
  slug: 'example-app',
  owner: { login: 'Example-Org' },
  pem: '-----BEGIN RSA PRIVATE KEY-----\nsynthetic fixture',
  webhook_secret: 'synthetic webhook',
  client_secret: 'unused fixture',
};

test('exchanges a claimed callback and stores only required parameters', async () => {
  const writes = [];
  let claimed = false;
  const result = await completeRegistration({
    query, attempt,
    consumeAttempt: async (input) => { assert.equal(input, attempt); return (claimed = true); },
    request: async (url, options) => {
      assert.ok(claimed);
      assert.equal(url, 'https://api.github.com/app-manifests/fake-code/conversions');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      return { ok: true, json: async () => app };
    },
    saveCredentials: (_, credentials) => saveAppParameters(async (write) => writes.push(write), '/repo-runner/pilot', credentials),
  });
  assert.deepEqual(result, { appId: 123, slug: 'example-app' });
  assert.deepEqual(writes, [
    { Name: '/repo-runner/pilot/app-key-base64', Type: 'SecureString', Value: Buffer.from(app.pem).toString('base64'), Overwrite: false },
    { Name: '/repo-runner/pilot/webhook-secret', Type: 'SecureString', Value: app.webhook_secret, Overwrite: false },
    { Name: '/repo-runner/pilot/app-id', Type: 'String', Value: '123', Overwrite: false },
  ]);
});

test('refuses replay and invalid callback codes before making a GitHub request', async () => {
  const request = test.mock.fn();
  await assert.rejects(completeRegistration({ query, attempt, consumeAttempt: async () => false, request }), /already used/);
  const invalid = new URLSearchParams({ state: attempt.state, code: '../other' });
  await assert.rejects(completeRegistration({ query: invalid, attempt, request }), /Invalid/);
  assert.equal(request.mock.callCount(), 0);
});

test('refuses an unexpected App owner and redacts storage errors', async () => {
  const common = { query, attempt, consumeAttempt: async () => true };
  const storage = test.mock.fn();
  await assert.rejects(completeRegistration({ ...common, saveCredentials: storage,
    request: async () => ({ ok: true, json: async () => ({ ...app, owner: { login: 'other' } }) }),
  }), /unexpected App details/);
  assert.equal(storage.mock.callCount(), 0);
  await assert.rejects(completeRegistration({ ...common,
    request: async () => ({ ok: true, json: async () => app }),
    saveCredentials: async () => { throw new Error('synthetic secret'); },
  }), { message: 'GitHub App credentials could not be fully stored. Recover the existing App before retrying.' });
});

test('stops partial writes without publishing the App ID', async () => {
  const put = test.mock.fn(async ({ Type }) => { if (Type === 'SecureString') throw new Error('synthetic secret'); });
  await assert.rejects(saveAppParameters(put, '/repo-runner/pilot', {}), /Parameter write failed/);
  assert.equal(put.mock.callCount(), 1);
});

test('reports a missing webhook secret with a fixed diagnostic and skips storage', async () => {
  const report = test.mock.fn();
  const saveCredentials = test.mock.fn();
  await assert.rejects(completeRegistration({ query, attempt, consumeAttempt: async () => true,
    request: async () => ({ ok: true, json: async () => ({ ...app, webhook_secret: null }) }),
    saveCredentials, report,
  }), /unexpected App details/);
  assert.deepEqual(report.mock.calls.map(({ arguments: args }) => args), [['github_app_webhook_secret_missing']]);
  assert.equal(saveCredentials.mock.callCount(), 0);
});
