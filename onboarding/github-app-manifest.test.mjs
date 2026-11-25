import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRegistration, readRegistrationCallback } from './github-app-manifest.mjs';

const input = {
  organization: 'example-org',
  appName: 'Example Repo Runner',
  homepage: 'https://example.test/',
  redirectUrl: 'https://example.test/onboarding/github/return',
};

test('builds a private organization App request with repository permissions', () => {
  const registration = createRegistration(input);
  const action = new URL(registration.action);
  assert.equal(action.origin, 'https://github.com');
  assert.equal(action.pathname, '/organizations/example-org/settings/apps/new');
  assert.equal(action.searchParams.get('state'), registration.state);
  assert.notEqual(createRegistration(input).state, registration.state);
  assert.deepEqual(JSON.parse(registration.fields.manifest), {
    name: input.appName, url: input.homepage, redirect_url: input.redirectUrl, public: false,
    hook_attributes: { url: 'https://example.test/webhook-not-configured', active: false }, default_events: ['workflow_job'],
    default_permissions: { actions: 'read', checks: 'read', metadata: 'read', administration: 'write' },
  });
});

test('rejects malformed organization names and insecure redirects', () => {
  assert.throws(() => createRegistration({ ...input, organization: '../other' }));
  assert.throws(() => createRegistration({ ...input, appName: 'x'.repeat(35) }), /34 characters/);
  assert.throws(() => createRegistration({ ...input, redirectUrl: 'http://example.test/' }));
});

test('accepts only an unambiguous callback with matching state', () => {
  const { state } = createRegistration(input);
  const query = new URLSearchParams({ state, code: 'synthetic-code' });
  assert.equal(readRegistrationCallback(query, state), 'synthetic-code');
  assert.throws(() => readRegistrationCallback(query, 'a'.repeat(64)));
  query.append('code', 'duplicate');
  assert.throws(() => readRegistrationCallback(query, state));
});
