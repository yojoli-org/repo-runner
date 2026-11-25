import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { bootstrap } from './customer-app-bootstrap.mjs';
import { verifyInstallationScope } from './github-installation-scope.mjs';
import { signAppJwt } from './github-app-jwt.mjs';
import { appParameterNames } from './parameter-store.mjs';
import { smoke } from './pilot-smoke.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const release = '8.1.1';
const workflowPath = '.github/workflows/pilot-smoke.yml';
const prefixPattern = /^[a-z0-9][a-z0-9-]{1,23}$/;

function parseConfig(config) {
  const { profile, region, account, repository, prefix, vpc, subnets, stateBucket, stateKey,
    appName, homepage, concurrency = 'reserved' } = config;
  if (!profile || !/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region ?? '') || !/^\d{12}$/.test(account ?? '')
    || !/^[A-Za-z0-9-]+\/[\w.-]+$/.test(repository ?? '') || !prefixPattern.test(prefix ?? '')
    || !/^vpc-[a-f0-9]+$/.test(vpc ?? '') || !Array.isArray(subnets) || !subnets.length
    || subnets.some((id) => !/^subnet-[a-f0-9]+$/.test(id)) || new Set(subnets).size !== subnets.length
    || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(stateBucket ?? '')
    || !/^[\w/-]+[.]tfstate$/.test(stateKey ?? '') || typeof appName !== 'string' || !appName.trim()
    || !['reserved', 'shared'].includes(concurrency)) {
    throw new Error('Check the installer inputs against docs/customer-install.example.json.');
  }
  const url = new URL(homepage);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('The App homepage must be an HTTPS URL.');
  }
  return { profile, region, account, repository, prefix, vpc, subnets, stateBucket, stateKey,
    appName: appName.trim(), homepage: url.href, concurrency, organization: repository.split('/')[0],
    path: '/repo-runner/' + prefix };
}

function runContext(config) {
  const env = { ...process.env, AWS_PROFILE: config.profile, PILOT_AWS_REGION: config.region,
    PILOT_AWS_ACCOUNT: config.account, PILOT_STATE_BUCKET: config.stateBucket, PILOT_STATE_KEY: config.stateKey,
    PILOT_SCALE_UP_CONCURRENCY: config.concurrency, GH_PROMPT_DISABLED: '1', AWS_CLI_AUTO_PROMPT: 'off',
  };
  for (const key of Object.keys(env)) {
    if (key === 'TF_DATA_DIR' || key.startsWith('TF_CLI_ARGS') || key.startsWith('TF_VAR_')) delete env[key];
  }
  return (file, args, { cwd, interactive = false } = {}) => {
    try {
      return execFileSync(file, args, { cwd, env, encoding: 'utf8',
        stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'] })?.trim();
    } catch {
      throw new Error(`${file} ${args[0]} failed. Review the installer output before retrying.`);
    }
  };
}

function preflight(config, run) {
  for (const tool of ['aws', 'terraform', 'gh']) run(tool, ['--version']);
  const aws = (args) => run('aws', ['--profile', config.profile, '--region', config.region, '--no-cli-pager', ...args]);
  if (aws(['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text']) !== config.account) {
    throw new Error('AWS profile points to a different account.');
  }
  const repo = JSON.parse(run('gh', ['api', 'repos/' + config.repository]));
  if (!repo.private || repo.full_name?.toLowerCase() !== config.repository.toLowerCase()) {
    throw new Error('Use the approved private pilot repository.');
  }
  const contents = JSON.parse(run('gh', ['api', `repos/${config.repository}/contents/${workflowPath}`]));
  const installed = Buffer.from(contents.content ?? '', 'base64').toString().replaceAll('\r\n', '\n');
  if (installed !== readFileSync(join(root, workflowPath), 'utf8')) {
    throw new Error('Merge the reviewed pilot smoke workflow into the private repository’s default branch first.');
  }
}

function prepareTerraform(config, run, workspace) {
  const source = join(root, 'infra', 'pilot');
  const pilot = join(workspace, 'pilot');
  mkdirSync(pilot, { mode: 0o700 });
  for (const name of ['install.sh', 'main.tf', 'variables.tf', '.terraform.lock.hcl', 'artifacts.sha256']) {
    copyFileSync(join(source, name), join(pilot, name));
  }
  const assets = join(pilot, 'artifacts');
  mkdirSync(assets, { mode: 0o700 });
  run('gh', ['release', 'download', 'v' + release, '--repo', 'github-aws-runners/terraform-aws-github-runner',
    '--pattern', 'webhook.zip', '--pattern', 'runners.zip', '--pattern', 'runner-binaries-syncer.zip', '--dir', assets],
  { interactive: true });
  const [key, secret, id] = appParameterNames(config.path);
  const parameter = (name) => ({ name, arn: `arn:aws:ssm:${config.region}:${config.account}:parameter${name}` });
  writeFileSync(join(pilot, 'terraform.tfvars.json'), JSON.stringify({
    prefix: config.prefix, aws_region: config.region, sandbox_account_id: config.account,
    vpc_id: config.vpc, subnet_ids: config.subnets, pilot_repository: config.repository,
    github_app_parameters: { id_ssm: parameter(id), key_base64_ssm: parameter(key), webhook_secret_ssm: parameter(secret) },
    scale_up_reserved_concurrent_executions: config.concurrency === 'shared' ? -1 : 1,
  }, null, 2), { mode: 0o600 });
  return pilot;
}

async function checkInstallation(config, appId) {
  const [keyName, , idName] = appParameterNames(config.path);
  const ssm = new SSMClient({ profile: config.profile, region: config.region });
  const { Parameters } = await ssm.send(new GetParametersCommand({ Names: [keyName, idName], WithDecryption: true }));
  const key = Parameters?.find(({ Name }) => Name === keyName)?.Value;
  if (!key || Parameters?.find(({ Name }) => Name === idName)?.Value !== String(appId)) {
    throw new Error('The saved GitHub App metadata does not match this installation.');
  }
  const appJwt = signAppJwt(appId, key);
  const response = await fetch(`https://api.github.com/orgs/${config.organization}/installation`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + appJwt },
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Install the App on the approved repository before running the smoke test.');
  const installation = await response.json();
  await verifyInstallationScope({ appId, installationId: installation.id, repository: config.repository, appJwt });
}

async function main() {
  const { values } = parseArgs({ options: { config: { type: 'string' }, resume: { type: 'string' } } });
  if (!values.config || !process.stdin.isTTY) {
    throw new Error('Run in a terminal: node onboarding/install-customer.mjs --config /path/to/customer-install.json');
  }
  process.umask(0o077);
  const config = parseConfig(JSON.parse(readFileSync(values.config, 'utf8')));
  const run = runContext(config);
  preflight(config, run);
  const parent = join(homedir(), '.repo-runner');
  mkdirSync(parent, { mode: 0o700, recursive: true });
  const workspace = values.resume ? resolve(values.resume) : mkdtempSync(join(parent, 'install-'));
  console.log(`Private installation workspace: ${workspace}`);
  const configRecord = join(workspace, 'installation.json');
  const serialized = JSON.stringify(config, null, 2);
  let pilot = join(workspace, 'pilot');
  if (values.resume) {
    if (readFileSync(configRecord, 'utf8') !== serialized) {
      throw new Error('Resume with the same installer configuration.');
    }
  } else {
    pilot = prepareTerraform(config, run, workspace);
    writeFileSync(configRecord, serialized, { mode: 0o600, flag: 'wx' });
  }
  const install = (...args) => run('bash', [join(pilot, 'install.sh'), ...args], { cwd: pilot, interactive: true });
  const endpointRecord = join(workspace, 'endpoint');
  if (!existsSync(endpointRecord)) {
    const plan = join(mkdtempSync(join(workspace, 'plan-')), 'install.tfplan');
    install('state');
    install('plan', plan);
    install('apply', plan);
    const endpoint = run('terraform', ['output', '-raw', 'webhook_endpoint'], { cwd: pilot });
    writeFileSync(endpointRecord, endpoint, { flag: 'wx' });
  }
  const webhookUrl = run('terraform', ['output', '-raw', 'webhook_endpoint'], { cwd: pilot });
  if (webhookUrl !== readFileSync(endpointRecord, 'utf8')) {
    throw new Error('The deployed webhook changed. Review the installation before continuing.');
  }
  const appRecord = join(workspace, 'app.json');
  let app;
  if (existsSync(appRecord)) {
    app = JSON.parse(readFileSync(appRecord, 'utf8'));
  } else {
    app = await bootstrap({ ...config, webhookUrl }, {
      announce: (url) => console.log('Open this local link to approve GitHub App creation:\n' + url),
    });
    writeFileSync(appRecord, JSON.stringify(app), { flag: 'wx' });
  }
  console.log(`Install the App on ${config.repository} only: https://github.com/apps/${app.slug}/installations/new`);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question('After installing the App, type yes to verify and run the smoke job: ');
    if (answer !== 'yes') throw new Error('Smoke test skipped. The AWS stack remains deployed.');
  } finally {
    terminal.close();
  }
  await checkInstallation(config, app.appId);
  const result = await smoke(config);
  console.log(`Setup verified. ARM64 worker ${result.worker} terminated, boot disk deleted, and runner registration removed.`);
  console.log('The control plane remains deployed. Keep the installation workspace for teardown.');
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
