import { authorizationRequest, exchangeSignIn, githubForm, httpsOrigin, readReturn } from './oauth.mjs';

import { awsDeploymentLink, customerRegistrationOrigin } from './aws-deployment.mjs';

const status = document.querySelector('#status');
const intro = document.querySelector('#intro');
const awsSetup = document.querySelector('#aws-setup');
const deployAws = document.querySelector('#deploy-aws');
let awsConfigured = false;
let customerApiOrigin;
const signIn = document.querySelector('#sign-in');
const connect = document.querySelector('#connect');
const clear = document.querySelector('#sign-out');
const installer = document.querySelector('#customer-installer');
const keys = { login: 'rr-login', github: 'rr-github-state', session: 'rr-session' };
const redirectUri = `${location.origin}${location.pathname}`;
const returnedQuery = location.search;
if (location.search || location.hash) history.replaceState(null, '', redirectUri);

function get(key) {
  const value = sessionStorage.getItem(key);
  return value ? JSON.parse(value) : null;
}

function show(message, signedIn) {
  status.textContent = message;
  signIn.hidden = signedIn;
  connect.hidden = !signedIn || (awsConfigured && !customerApiOrigin);
  awsSetup.hidden = !signedIn || !awsConfigured;
  clear.hidden = !signedIn;
  installer.hidden = true;
}

function activeSession() {
  const saved = get(keys.session);
  if (saved?.expiresAt > Date.now() && typeof saved.token === 'string') return saved;
  sessionStorage.removeItem(keys.session);
  return null;
}

async function api(config, path, method, query) {
  const auth = activeSession();
  if (!auth) throw new Error('Your sandbox session expired. Please sign in again.');
  const url = new URL(`/api/onboarding/github/${path}`, customerApiOrigin ?? httpsOrigin(config.apiOrigin));
  if (query) url.search = query;
  const response = await fetch(url, { method, redirect: 'error', cache: 'no-store',
    headers: { Authorization: `Bearer ${auth.token}` } });
  if (response.status === 401) sessionStorage.removeItem(keys.session);
  if (path === 'start' && response.status === 403) {
    const problem = await response.json().catch(() => null);
    if (problem?.code === 'customer_aws_access_denied') {
      throw Object.assign(new Error('Your AWS account denied access from the portal. Use the installer with your own AWS session.'), {
        code: problem.code,
      });
    }
  }
  if (!response.ok) throw new Error(path === 'callback'
    ? 'GitHub setup did not complete. Check whether the App was created before trying again.'
    : 'Could not start GitHub setup. Check your sandbox access and try again.');
  return response.json();
}

async function start() {
  const response = await fetch('./config.json', { cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error('Sandbox configuration is unavailable.');
  const config = await response.json();
  httpsOrigin(config.apiOrigin);
  httpsOrigin(config.cognitoOrigin);
  if (!config.clientId || !config.scope) throw new Error('Sandbox sign-in is not configured.');
  if (config.awsDeployment !== undefined) {
    deployAws.href = awsDeploymentLink(config.awsDeployment);
    if (config.awsDeployment.registrationApiOrigin !== undefined) {
      customerApiOrigin = customerRegistrationOrigin(config.awsDeployment.registrationApiOrigin, config.awsDeployment.region);
      deployAws.hidden = true;
      document.querySelector('#aws-approval-note').hidden = true;
    }
    for (const [id, key] of [['aws-account', 'account'], ['aws-region', 'region'], ['aws-repository', 'repository']]) {
      document.querySelector('#' + id).textContent = config.awsDeployment[key];
    }
    awsConfigured = true;
    intro.textContent = 'Deploy an on-demand GitHub Actions runner pool in your AWS account.';
  }
  const ready = customerApiOrigin ? 'AWS deployment is ready. Continue to GitHub to connect your repository.'
    : awsConfigured ? 'Signed in. Review the destination, then approve deployment in AWS.'
    : 'Signed in. Continue to GitHub when you’re ready.';

  clear.onclick = () => {
    Object.values(keys).forEach((key) => sessionStorage.removeItem(key));
    show('Session cleared from this tab.', false);
  };
  signIn.onclick = async () => {
    signIn.disabled = true;
    try {
      const login = await authorizationRequest(config, redirectUri);
      sessionStorage.setItem(keys.login, JSON.stringify({ state: login.state, verifier: login.verifier }));
      location.assign(login.url);
    } catch {
      show('Could not open sign-in. Please try again.', false);
    } finally {
      signIn.disabled = false;
    }
  };
  connect.onclick = async () => {
    connect.disabled = true;
    try {
      const setup = githubForm(await api(config, 'start', 'POST'));
      sessionStorage.setItem(keys.github, JSON.stringify(setup.state));
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = setup.action;
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = 'manifest'; input.value = setup.manifest;
      form.append(input);
      document.body.append(form);
      form.submit();
    } catch (error) {
      const blocked = error?.code === 'customer_aws_access_denied';
      show(blocked ? error.message : 'Could not start GitHub setup. Check your sandbox access and try again.', Boolean(activeSession()));
      installer.hidden = !blocked;
    } finally {
      connect.disabled = false;
    }
  };

  if (!returnedQuery) {
    show(activeSession() ? ready : 'Sign in to start setup.', Boolean(activeSession()));
    return;
  }

  const login = get(keys.login);
  const result = readReturn(returnedQuery, { loginState: login?.state, githubState: get(keys.github) });
  if (!result) {
    show('This return link doesn’t match an active setup in this tab.', Boolean(activeSession()));
    return;
  }
  if (result.kind === 'login') {
    sessionStorage.removeItem(keys.login);
    try {
      const auth = await exchangeSignIn(config, redirectUri, result.code, login.verifier);
      sessionStorage.setItem(keys.session, JSON.stringify(auth));
      show(ready, true);
    } catch {
      show('Sign-in could not be completed. Please sign in again.', false);
    }
    return;
  }

  sessionStorage.removeItem(keys.github);
  status.textContent = 'Completing GitHub App registration…';
  try {
    const { slug } = await api(config, 'callback', 'GET', new URLSearchParams({ code: result.code, state: result.state }));
    status.textContent = `App registered: ${slug}. Installation and webhook verification are separate steps.`;
    clear.hidden = false;
  } catch {
    show('GitHub setup did not complete. Check whether the App was created before trying again.', Boolean(activeSession()));
    connect.hidden = true;
  }
}

start().catch(() => { status.textContent = 'This sandbox is not ready. Ask the operator to check the portal configuration.'; });
