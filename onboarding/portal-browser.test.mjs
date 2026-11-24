import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizationRequest, exchangeSignIn, githubForm, httpsOrigin, readReturn } from '../portal/oauth.mjs';

const config = { cognitoOrigin: 'https://login.example.test', clientId: 'fixture', scope: 'registration/start' };
const redirect = 'https://portal.example.test/';

test('uses PKCE and exchanges the code with a public client', async () => {
  const login = await authorizationRequest(config, redirect);
  const url = new URL(login.url);
  assert.equal(url.pathname, '/oauth2/authorize');
  assert.equal(url.searchParams.get('state'), login.state);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('code_challenge'), /^[\w-]{43}$/);
  assert.notEqual(url.searchParams.get('code_challenge'), login.verifier);
  const auth = await exchangeSignIn(config, redirect, 'fixture-code', login.verifier, async (target, options) => {
    assert.equal(target.href, 'https://login.example.test/oauth2/token');
    assert.equal(options.body.get('code_verifier'), login.verifier);
    assert.equal(options.body.get('client_secret'), null);
    return Response.json({ access_token: 'fixture-token', refresh_token: 'unused', token_type: 'Bearer', expires_in: 900 });
  });
  assert.equal(auth.token, 'fixture-token');
  assert.deepEqual(Object.keys(auth).sort(), ['expiresAt', 'token']);
});

test('distinguishes sign-in and GitHub returns by tab state and refuses duplicates', () => {
  const states = { loginState: 'login', githubState: 'github' };
  assert.deepEqual(readReturn('?state=login&code=x', states), { kind: 'login', code: 'x' });
  assert.deepEqual(readReturn('?state=github&code=x', states), { kind: 'github', code: 'x', state: 'github' });
  for (const query of ['?state=other&code=x', '?state=login&code=x&code=y', '?state=login&code=x&error=denied']) {
    assert.equal(readReturn(query, states), null);
  }
});

test('rejects unexpected destinations before submitting the manifest', () => {
  const state = 'a'.repeat(64);
  const fields = { manifest: '{}' };
  assert.equal(githubForm({ fields, action: `https://github.com/organizations/example/settings/apps/new?state=${state}` }).state, state);
  assert.throws(() => githubForm({ fields, action: `https://github.com.example.test/organizations/example/settings/apps/new?state=${state}` }));
  assert.throws(() => httpsOrigin('https://user:pass@example.test'));
  assert.throws(() => httpsOrigin('http://example.test'));
});
