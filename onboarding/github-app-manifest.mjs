import { randomBytes, timingSafeEqual } from 'node:crypto';

function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Use an HTTPS URL without credentials or a fragment.');
  }
  return url.href;
}

// Call on the server. Persist state against the authenticated installation
// attempt before returning the form fields to the browser.
export function createRegistration({ organization, appName, homepage, redirectUrl, localCallback = false }) {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(organization ?? '')) {
    throw new Error('Provide a GitHub organization login.');
  }
  if (typeof appName !== 'string' || !appName.trim()) {
    throw new Error('Provide a GitHub App name.');
  }

  const appHomepage = httpsUrl(homepage);
  const callback = new URL(redirectUrl);
  const loopback = localCallback && callback.protocol === 'http:' && callback.hostname === '127.0.0.1'
    && callback.port && callback.pathname === '/callback' && !callback.search
    && !callback.username && !callback.password && !callback.hash;
  const state = randomBytes(32).toString('hex');
  const action = new URL(`https://github.com/organizations/${organization}/settings/apps/new`);
  action.searchParams.set('state', state);

  return {
    state,
    action: action.href,
    fields: {
      manifest: JSON.stringify({
        name: appName.trim(),
        url: appHomepage,
        redirect_url: loopback ? callback.href : httpsUrl(redirectUrl),
        public: false,
        // GitHub validates the webhook URL even with delivery disabled.
        hook_attributes: { url: new URL('/webhook-not-configured', appHomepage).href, active: false },
        default_events: ['workflow_job'],
        default_permissions: { actions: 'read', checks: 'read', metadata: 'read', administration: 'write' },
      }),
    },
  };
}

// The caller must load unexpired state for this user and atomically consume
// the attempt before exchanging the returned code. Never log the code.
export function readRegistrationCallback(query, expectedState) {
  const states = query.getAll('state');
  const codes = query.getAll('code');
  const validState = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (states.length !== 1 || codes.length !== 1 || !codes[0].trim()
    || !validState(expectedState) || !validState(states[0])
    || !timingSafeEqual(Buffer.from(states[0]), Buffer.from(expectedState))) {
    throw new Error('Invalid GitHub App registration callback.');
  }
  return codes[0];
}
