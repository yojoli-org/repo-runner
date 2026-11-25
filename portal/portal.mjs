import { authorizationRequest, exchangeSignIn, githubForm, httpsOrigin, readReturn } from './oauth.mjs';

import { awsDeploymentLink, customerRegistrationOrigin } from './aws-deployment.mjs';

const status = document.querySelector('#status');
const intro = document.querySelector('#intro');
const awsSetup = document.querySelector('#aws-setup');
const deployAws = document.querySelector('#deploy-aws');
let awsConfigured = false;
let customerApiOrigin;
let smokeEnabled = false;
let smokePoll;
let deploymentTracking = false;
let deploymentReady = false;
let deploymentPoll;
let deploymentCheckPending = false;
const signIn = document.querySelector('#sign-in');
const connect = document.querySelector('#connect');
const verifyRunner = document.querySelector('#verify-runner');
const clear = document.querySelector('#sign-out');
const installer = document.querySelector('#customer-installer');
const installApp = document.querySelector('#install-app');
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
  connect.hidden = !signedIn || (awsConfigured && (!customerApiOrigin || (deploymentTracking && !deploymentReady)));
  awsSetup.hidden = !signedIn || !awsConfigured;
  clear.hidden = !signedIn;
  verifyRunner.hidden = !signedIn || !smokeEnabled || (deploymentTracking && !deploymentReady);
  installer.hidden = true;
  installApp.hidden = true;
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

async function smokeStatus(start = false) {
  const auth = activeSession();
  if (!auth) {
    show('Sign in to check runner verification.', false);
    return;
  }
  const endpoint = new URL('/api/onboarding/smoke/' + (start ? 'start' : 'status'), customerApiOrigin);
  try {
    const response = await fetch(endpoint, { method: start ? 'POST' : 'GET', redirect: 'error', cache: 'no-store',
      headers: { Authorization: `Bearer ${auth.token}` } });
    if (activeSession()?.token !== auth.token) return;
    if (response.status === 401) {
      sessionStorage.removeItem(keys.session);
      show('Sign in to check runner verification.', false);
      return;
    }
    const { state } = await response.json();
    if (!response.ok && state !== 'unconfirmed') throw new Error();
    if (state === 'idle') return;
    const messages = {
      starting: 'Starting runner verification…',
      running: 'Verifying the smoke job and worker cleanup…',
      ready: 'Runner ready. The ARM64 smoke job passed and the worker was cleaned up.',
      failed: 'Runner verification failed. Ask the operator to check the smoke job.',
      unconfirmed: 'Runner verification could not be confirmed. Ask the operator to check before retrying.',
    };
    if (!Object.hasOwn(messages, state)) throw new Error();
    status.textContent = messages[state];
    verifyRunner.hidden = true;
    installApp.hidden = true;
    connect.hidden = true;
    if (state === 'starting' || state === 'running') smokePoll = setTimeout(() => smokeStatus(), 5000);
  } catch {
    status.textContent = 'Could not check runner verification. Reload to check the current status.';
  }
}

async function refreshSetup() {
  const auth = activeSession();
  if (!auth) return;
  if (!deploymentTracking || deploymentReady) {
    if (smokeEnabled) await smokeStatus();
    return;
  }
  if (deploymentCheckPending) return;
  deploymentCheckPending = true;
  clearTimeout(deploymentPoll);
  try {
    const response = await fetch(new URL('/api/onboarding/deployment/status', customerApiOrigin), {
      redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (activeSession()?.token !== auth.token) return;
    if (response.status === 401) {
      sessionStorage.removeItem(keys.session);
      show('Sign in to check AWS deployment.', false);
      return;
    }
    if (!response.ok) throw new Error();
    const { state } = await response.json();
    switch (state) {
      case 'awaiting_approval':
        deployAws.hidden = false;
        show('Review the destination, then approve deployment in AWS.', true);
        break;
      case 'deploying':
        deployAws.hidden = true;
        show('AWS is deploying the runner pool…', true);
        deploymentPoll = setTimeout(refreshSetup, 8000);
        break;
      case 'ready':
        deploymentReady = true;
        deployAws.hidden = true;
        document.querySelector('#aws-approval-note').hidden = true;
        show('AWS deployment is ready. Continue to GitHub to connect your repository.', true);
        if (smokeEnabled) await smokeStatus();
        break;
      case 'failed':
      case 'unconfirmed':
        deployAws.hidden = true;
        show('Could not confirm AWS deployment. Check the approved stack before retrying.', true);
        break;
      default:
        throw new Error();
    }
  } catch {
    status.textContent = 'Could not check AWS deployment. Reload to check the current status.';
  } finally {
    deploymentCheckPending = false;
  }
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
      smokeEnabled = config.awsDeployment.smokeVerification === true;
      deploymentTracking = config.awsDeployment.trackDeployment === true;
      deployAws.hidden = !deploymentTracking;
      document.querySelector('#aws-approval-note').hidden = !deploymentTracking;
    }
    for (const [id, key] of [['aws-account', 'account'], ['aws-region', 'region'], ['aws-repository', 'repository']]) {
      document.querySelector('#' + id).textContent = config.awsDeployment[key];
    }
    awsConfigured = true;
    intro.textContent = 'Deploy an on-demand GitHub Actions runner pool in your AWS account.';
  }
  const ready = deploymentTracking ? 'Checking AWS deployment…'
    : customerApiOrigin ? 'AWS deployment is ready. Continue to GitHub to connect your repository.'
    : awsConfigured ? 'Signed in. Review the destination, then approve deployment in AWS.'
    : 'Signed in. Continue to GitHub when you’re ready.';

  clear.onclick = () => {
    clearTimeout(smokePoll);
    clearTimeout(deploymentPoll);
    Object.values(keys).forEach((key) => sessionStorage.removeItem(key));
    show('Session cleared from this tab.', false);
  };
  if (deploymentTracking) {
    window.addEventListener('focus', () => { if (!deploymentReady) void refreshSetup(); });
  }
  verifyRunner.onclick = async () => {
    verifyRunner.disabled = true;
    try {
      await smokeStatus(true);
    } finally {
      verifyRunner.disabled = false;
    }
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
    await refreshSetup();
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
      await refreshSetup();
    } catch {
      show('Sign-in could not be completed. Please sign in again.', false);
    }
    return;
  }

  sessionStorage.removeItem(keys.github);
  status.textContent = 'Completing GitHub App registration…';
  try {
    const { slug } = await api(config, 'callback', 'GET', new URLSearchParams({ code: result.code, state: result.state }));
    if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid App slug.');
    status.textContent = `App registered: ${slug}. Install it on the approved repository` +
      (smokeEnabled ? ', then select Verify runner.' : '.');
    installApp.href = `https://github.com/apps/${slug}/installations/new`;
    installApp.hidden = false;
    clear.hidden = false;
    verifyRunner.hidden = !smokeEnabled;
  } catch {
    show('GitHub setup did not complete. Check whether the App was created before trying again.', Boolean(activeSession()));
    connect.hidden = true;
  }
}

start().catch(() => { status.textContent = 'This sandbox is not ready. Ask the operator to check the portal configuration.'; });
