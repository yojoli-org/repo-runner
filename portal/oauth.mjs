const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

export function httpsOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.href !== `${url.origin}/`) throw new Error('Expected an HTTPS origin.');
  return url.origin;
}

export async function authorizationRequest(config, redirectUri) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const url = new URL('/oauth2/authorize', httpsOrigin(config.cognitoOrigin));
  url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: redirectUri,
    scope: `openid ${config.scope}`, state, code_challenge: challenge, code_challenge_method: 'S256' });
  return { url: url.href, state, verifier };
}

export async function exchangeSignIn(config, redirectUri, code, verifier, request = fetch) {
  const response = await request(new URL('/oauth2/token', httpsOrigin(config.cognitoOrigin)), {
    method: 'POST', redirect: 'error', cache: 'no-store',
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId,
      redirect_uri: redirectUri, code, code_verifier: verifier }),
  });
  if (!response.ok) throw new Error('Sign-in could not be completed. Please sign in again.');
  const { access_token: token, expires_in: expiresIn, token_type: tokenType } = await response.json();
  if (typeof token !== 'string' || !token || !Number.isFinite(expiresIn) || expiresIn <= 0
    || tokenType?.toLowerCase() !== 'bearer') throw new Error('Sign-in did not return an access token.');
  return { token, expiresAt: Date.now() + expiresIn * 1000 };
}

export function readReturn(search, { loginState, githubState }) {
  const query = new URLSearchParams(search);
  const states = query.getAll('state');
  const codes = query.getAll('code');
  if (states.length !== 1 || codes.length !== 1 || !codes[0] || query.has('error')) return null;
  if (states[0] === loginState) return { kind: 'login', code: codes[0] };
  if (states[0] === githubState) return { kind: 'github', code: codes[0], state: states[0] };
  return null;
}

export function githubForm({ action, fields }) {
  const url = new URL(action);
  const states = url.searchParams.getAll('state');
  if (url.origin !== 'https://github.com' || url.username || url.password || url.hash
    || !/^\/organizations\/[a-z\d-]+\/settings\/apps\/new$/i.test(url.pathname)
    || states.length !== 1 || !/^[a-f0-9]{64}$/.test(states[0]) || typeof fields?.manifest !== 'string') {
    throw new Error('The portal returned an invalid GitHub setup request.');
  }
  return { action: url.href, state: states[0], manifest: fields.manifest };
}
