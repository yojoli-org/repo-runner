import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyInstallationScope } from './github-installation-scope.mjs';

const approved = { appId: 12, installationId: 34, repository: 'example-org/private-test', appJwt: 'fake-app-jwt' };
const installation = { id: 34, app_id: 12, target_type: 'Organization', suspended_at: null,
  repository_selection: 'selected', account: { login: 'Example-Org' } };
const listing = { total_count: 1, repositories: [{ private: true, full_name: 'Example-Org/private-test' }] };

function responses(...items) {
  return test.mock.fn(async () => ({ ok: true, json: async () => items.shift() }));
}

test('verifies the full installation repository grant using a metadata-only token', async () => {
  const request = responses(installation, { token: 'fake-install-token' }, listing);
  assert.deepEqual(await verifyInstallationScope({ ...approved, request }), {
    installationId: 34, repository: 'Example-Org/private-test',
  });
  const [lookup, mint, list] = request.mock.calls.map(({ arguments: args }) => args);
  assert.equal(lookup[0], 'https://api.github.com/app/installations/34');
  assert.equal(mint[0], 'https://api.github.com/app/installations/34/access_tokens');
  assert.equal(mint[1].method, 'POST');
  assert.deepEqual(JSON.parse(mint[1].body), { permissions: { metadata: 'read' } });
  assert.equal(list[0], 'https://api.github.com/installation/repositories?per_page=2');
  assert.equal(list[1].headers.Authorization, 'Bearer fake-install-token');
});

test('rejects all-repo, wrong-account, wrong-App and suspended installations before minting', async () => {
  for (const changes of [{ repository_selection: 'all' }, { account: { login: 'other' } },
    { app_id: 99 }, { suspended_at: 'fixture' }]) {
    const request = responses({ ...installation, ...changes });
    await assert.rejects(verifyInstallationScope({ ...approved, request }), /selected repositories/);
    assert.equal(request.mock.callCount(), 1);
  }
});

test('rejects extra, public or unexpected repositories and redacts provider failures', async () => {
  for (const invalid of [{ ...listing, total_count: 2 },
    { total_count: 1, repositories: [{ ...listing.repositories[0], private: false }] },
    { total_count: 1, repositories: [{ private: true, full_name: 'example-org/other' }] }]) {
    await assert.rejects(verifyInstallationScope({ ...approved,
      request: responses(installation, { token: 'fixture' }, invalid) }), /approved private pilot repository/);
  }
  await assert.rejects(verifyInstallationScope({ ...approved,
    request: async () => { throw new Error('fake secret'); } }),
  { message: 'GitHub installation scope could not be verified.' });
});
