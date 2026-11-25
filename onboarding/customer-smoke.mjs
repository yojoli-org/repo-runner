import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { signAppJwt } from './github-app-jwt.mjs';
import { verifyInstallationScope } from './github-installation-scope.mjs';
import { appParameterNames } from './parameter-store.mjs';
import { smoke, smokeAws } from './pilot-smoke.mjs';

const workflow = '/actions/workflows/pilot-smoke.yml';
const api = 'https://api.github.com';

async function github(path, token, request, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await request(api + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10',
        Authorization: 'Bearer ' + token, ...(body && { 'Content-Type': 'application/json' }) },
      ...(body && { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error();
    return response.status === 204 ? null : await response.json();
  } catch {
    throw new Error('GitHub smoke verification request failed. Check the approved App permissions and workflow.');
  }
}

export function smokeGitHub(repository, token, request) {
  const repo = '/repos/' + repository;
  const read = (path) => github(repo + path, token, request);
  return {
    repo: () => read(''),
    async runners() { return (await read('/actions/runners?per_page=1')).total_count; },
    async pending() {
      for (const status of ['requested', 'queued', 'pending', 'waiting', 'in_progress']) {
        if ((await read(workflow + '/runs?per_page=1&status=' + status)).total_count > 0) return true;
      }
      return false;
    },
    async dispatch(ref) {
      const approved = await read(workflow);
      if (approved.path !== '.github/workflows/pilot-smoke.yml' || approved.state !== 'active') {
        throw new Error('The approved smoke workflow must be active on the default branch.');
      }
      const result = await github(repo + workflow + '/dispatches', token, request, { method: 'POST', body: { ref } });
      const runId = result?.workflow_run_id;
      const expected = 'https://github.com/' + repository + '/actions/runs/' + runId;
      if (!Number.isSafeInteger(runId) || runId <= 0 || result.html_url?.toLowerCase() !== expected.toLowerCase()) {
        throw new Error('GitHub did not return the exact smoke run. Check for an existing run before retrying.');
      }
      return expected;
    },
    run: (id) => read('/actions/runs/' + id),
    jobs: (id) => read('/actions/runs/' + id + '/jobs?per_page=2'),
    cancel: (id) => github(repo + '/actions/runs/' + id + '/cancel', token, request, { method: 'POST' }),
  };
}

export async function customerSmoke(config, {
  aws = smokeAws(config), ssm = new SSMClient({ region: config.region }), request = fetch, verify = smoke,
} = {}) {
  const { account, prefix, region, repository } = config;
  if (!/^\d{12}$/.test(account ?? '') || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region ?? '')
    || !/^[a-z0-9][a-z0-9-]{1,23}$/.test(prefix ?? '') || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
    throw new Error('Provide the approved account, region, pool and repository.');
  }
  if (await aws.account() !== account) throw new Error('AWS identity points to a different account.');
  const [owner, name] = repository.split('/');
  const [key, , id] = appParameterNames('/repo-runner/' + prefix);
  const response = await ssm.send(new GetParametersCommand({ Names: [key, id], WithDecryption: true }));
  const parameters = new Map(response.Parameters?.map(({ Name, Value }) => [Name, Value]));
  const appId = Number(parameters.get(id));
  if (!Number.isSafeInteger(appId) || appId <= 0 || !parameters.get(key)) {
    throw new Error('The approved App credentials are missing.');
  }
  const jwt = signAppJwt(appId, parameters.get(key));
  const installation = await github('/orgs/' + owner + '/installation', jwt, request);
  await verifyInstallationScope({ appId, installationId: installation.id, repository, appJwt: jwt, request });
  const { token } = await github('/app/installations/' + installation.id + '/access_tokens', jwt, request, {
    method: 'POST', body: { repositories: [name], permissions: { actions: 'write', administration: 'read' } },
  });
  if (typeof token !== 'string' || !token) throw new Error('GitHub did not return a smoke verification token.');

  try {
    return await verify(config, { io: { ...aws, ...smokeGitHub(repository, token, request) } });
  } finally {
    await github('/installation/token', token, request, { method: 'DELETE' }).catch(() => {});
  }
}

if (import.meta.main) {
  try {
    const { EXPECTED_ACCOUNT_ID: account, AWS_REGION: region, PILOT_PREFIX: prefix, PILOT_REPOSITORY: repository } = process.env;
    const { runId } = await customerSmoke({ account, region, prefix, repository });
    console.log(JSON.stringify({ result: 'runner_ready', repository, runId }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
