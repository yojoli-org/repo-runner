import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { customerSmoke, smokeGitHub } from './customer-smoke.mjs';
import { createRegistration } from './github-app-manifest.mjs';

const config = {
  account: '123456789012', region: 'us-east-2', prefix: 'rr-sandbox', repository: 'example-org/repo',
};
const appKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
const runUrl = 'https://github.com/example-org/repo/actions/runs/123';

test('uses the verified customer installation and revokes the scoped smoke token', async () => {
  const calls = [];
  const installation = { id: 9, app_id: 42, target_type: 'Organization', repository_selection: 'selected',
    suspended_at: null, account: { login: 'example-org' } };
  const request = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === '/orgs/example-org/installation' || path === '/app/installations/9') return Response.json(installation);
    if (path === '/app/installations/9/access_tokens') {
      const body = JSON.parse(options.body);
      if (body.permissions.metadata === 'read') return Response.json({ token: 'fixture-metadata' });
      assert.deepEqual(body, { repositories: ['repo'], permissions: { actions: 'write', administration: 'read' } });
      return Response.json({ token: 'fixture-smoke' });
    }
    if (path === '/installation/repositories') {
      return Response.json({ total_count: 1, repositories: [{ private: true, full_name: config.repository }] });
    }
    if (path.endsWith('/pilot-smoke.yml')) return Response.json({ path: '.github/workflows/pilot-smoke.yml', state: 'active' });
    if (path.endsWith('/dispatches')) {
      assert.deepEqual(JSON.parse(options.body), { ref: 'main' });
      assert.equal(options.headers.Authorization, 'Bearer fixture-smoke');
      return Response.json({ workflow_run_id: 123, html_url: runUrl });
    }
    if (path === '/installation/token') {
      assert.equal(options.method, 'DELETE');
      return new Response(null, { status: 204 });
    }
    assert.fail('Unexpected GitHub request: ' + path);
  };
  const result = await customerSmoke(config, {
    aws: { account: () => config.account },
    ssm: { async send({ input }) {
      assert.deepEqual(input.Names, ['/repo-runner/rr-sandbox/app-key-base64', '/repo-runner/rr-sandbox/app-id']);
      return { Parameters: [{ Name: input.Names[0], Value: Buffer.from(appKey).toString('base64') },
        { Name: input.Names[1], Value: '42' }] };
    } },
    request,
    async verify(_, { io }) {
      assert.equal(await io.dispatch('main'), runUrl);
      return { runId: '123' };
    },
  });
  assert.deepEqual(result, { runId: '123' });
  assert.equal(calls.at(-1), '/installation/token');
});

test('a wrong AWS account cannot read the App key', async () => {
  await assert.rejects(customerSmoke(config, {
    aws: { account: () => '999999999999' },
    ssm: { send: () => assert.fail('Should not read credentials') },
  }), /different account/);
});

test('a dispatch response must identify the exact run in the approved repository', async () => {
  const client = smokeGitHub(config.repository, 'fixture', async (url) => url.endsWith('/dispatches')
    ? Response.json({ workflow_run_id: 123, html_url: 'https://github.com/example-org/other/actions/runs/123' })
    : Response.json({ path: '.github/workflows/pilot-smoke.yml', state: 'active' }));
  await assert.rejects(client.dispatch('main'), /exact smoke run/);
});

test('manifest requests Actions write only for explicit smoke permission', () => {
  const input = { organization: 'example-org', appName: 'Example App', homepage: 'https://example.test',
    redirectUrl: 'https://example.test/' };
  assert.equal(JSON.parse(createRegistration(input).fields.manifest).default_permissions.actions, 'read');
  assert.equal(JSON.parse(createRegistration({ ...input, allowSmokeDispatch: true }).fields.manifest).default_permissions.actions, 'write');
});
