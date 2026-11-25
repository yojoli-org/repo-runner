import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const workflow = 'pilot-smoke.yml';
const active = (worker) => worker.State.Name !== 'terminated';

function command(binary, args, label) {
  try {
    return execFileSync(binary, args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 25000,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', AWS_CLI_AUTO_PROMPT: 'off' },
    }).trim();
  } catch {
    throw new Error(label + ' failed. Check the selected account, repository, and operator permissions.');
  }
}

export function smokeAws({ profile, region, prefix }) {
  const aws = (...args) => command('aws', [...(profile ? ['--profile', profile] : []), '--region', region, '--no-cli-pager',
    ...args, '--output', 'json'], 'AWS ' + args.slice(0, 2).join(' '));
  return {
    account: () => JSON.parse(aws('sts', 'get-caller-identity')).Account,
    queueReady: () => JSON.parse(aws('lambda', 'list-event-source-mappings', '--function-name',
      prefix + '-scale-up')).EventSourceMappings.some((mapping) => mapping.State === 'Enabled'
      && mapping.EventSourceArn?.endsWith(':' + prefix + '-queued-builds')),
    workers: () => JSON.parse(aws('ec2', 'describe-instances', '--filters',
      'Name=tag:ghr:environment,Values=' + prefix, '--query', 'Reservations[].Instances[]')),
    volumes: (ids) => JSON.parse(aws('ec2', 'describe-volumes', '--filters',
      'Name=volume-id,Values=' + ids.join(','), '--query', 'Volumes[].VolumeId')),
  };
}

function providers(config) {
  const { repository } = config;
  if (!config.profile) throw new Error('Select the expected AWS profile for the CLI smoke test.');
  const gh = (...args) => command('gh', args, 'GitHub ' + args.slice(0, 2).join(' '));
  const api = (suffix) => JSON.parse(gh('api', 'repos/' + repository + suffix));
  return {
    ...smokeAws(config),
    repo: () => api(''),
    runners: () => api('/actions/runners?per_page=1').total_count,
    pending: () => ['requested', 'queued', 'pending', 'waiting', 'in_progress'].some((status) => {
      const runs = api('/actions/workflows/' + workflow + '/runs?per_page=1&status=' + status);
      return runs.total_count > 0;
    }),
    dispatch: (ref) => gh('workflow', 'run', workflow, '--repo', repository, '--ref', ref),
    run: (id) => api('/actions/runs/' + id),
    jobs: (id) => api('/actions/runs/' + id + '/jobs?per_page=2'),
    cancel: (id) => gh('run', 'cancel', id, '--repo', repository),
  };
}

export async function smoke(config, {
  io = providers(config), pause = delay, now = Date.now, report = console.log,
  jobTimeoutMs = 600000, cleanupTimeoutMs = 600000,
} = {}) {
  const { region, account, repository, prefix } = config;
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region ?? '') || !/^\d{12}$/.test(account ?? '')
    || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[a-z0-9][a-z0-9-]+$/.test(prefix ?? '')) {
    throw new Error('Provide the verified AWS profile, region, account, private repository, and pilot prefix.');
  }
  if (await io.account() !== account) throw new Error('AWS identity points to a different account.');
  const repo = await io.repo();
  if (!repo.private || repo.full_name.toLowerCase() !== repository.toLowerCase() || !repo.default_branch) {
    throw new Error('The smoke test requires the approved private repository.');
  }
  if (!await io.queueReady()) throw new Error('The pilot scale-up queue trigger is not enabled.');
  if ((await io.workers()).some(active) || await io.runners() !== 0 || await io.pending()) {
    throw new Error('The smoke test requires zero active workers, registered runners, and pending smoke runs.');
  }

  const dispatchTime = now();
  const location = await io.dispatch(repo.default_branch);
  const match = location.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/actions\/runs\/(\d+)$/i);
  if (match?.[1].toLowerCase() !== repository.toLowerCase()) {
    throw new Error('GitHub did not return the exact smoke run URL. Check the repository for a dispatched run before retrying.');
  }
  const runId = match[2];
  report(location);
  const workers = new Map();
  const jobDeadline = dispatchTime + jobTimeoutMs;
  let cleanupDeadline;
  let run;
  let cancelled = false;
  do {
    for (const worker of await io.workers()) {
      const launched = Date.parse(worker.LaunchTime);
      if (launched < dispatchTime - 1000 && !active(worker)) continue;
      const volumes = workers.get(worker.InstanceId)?.volumes ?? new Set();
      for (const disk of worker.BlockDeviceMappings ?? []) {
        if (disk.Ebs?.VolumeId) volumes.add(disk.Ebs.VolumeId);
      }
      workers.set(worker.InstanceId, { worker, volumes });
    }

    run = await io.run(runId);
    if (run.status !== 'completed' && now() >= jobDeadline && !cancelled) {
      try {
        await io.cancel(runId);
      } catch (error) {
        if ((await io.run(runId)).status !== 'completed') throw error;
      }
      cancelled = true;
      report('Smoke run exceeded the deadline. Checking cleanup.');
    }
    if (run.status === 'completed' || cancelled) {
      cleanupDeadline ??= now() + cleanupTimeoutMs;
      const volumes = [...workers.values()].flatMap((entry) => [...entry.volumes]);
      const instancesGone = [...workers.values()].every(({ worker }) => !active(worker));
      if (run.status === 'completed' && instancesGone
        && (!volumes.length || (await io.volumes(volumes)).length === 0) && await io.runners() === 0) break;
      if (now() >= cleanupDeadline) throw new Error('Smoke cleanup could not be verified. Check the reported run and pilot pool.');
    }
    await pause(5000);
  } while (true);

  if (run.conclusion !== 'success' || cancelled) {
    throw new Error('Smoke job did not pass. All observed workers, disks, and runner registrations are gone.');
  }
  const jobs = await io.jobs(runId);
  const job = jobs.jobs?.[0];
  const observed = workers.get(job?.runner_name);
  if (jobs.total_count !== 1 || jobs.jobs?.length !== 1 || job?.conclusion !== 'success'
    || !job.steps?.some((step) => step.name === 'Check native ARM64 Linux execution' && step.conclusion === 'success')
    || workers.size !== 1 || observed?.worker.Architecture !== 'arm64' || observed.volumes.size === 0) {
    throw new Error('The run passed, but one ARM64 worker and its boot disk could not be verified.');
  }
  return { runId, worker: observed.worker.InstanceId, volumes: [...observed.volumes] };
}

if (import.meta.main) {
  try {
    const options = Object.fromEntries(['profile', 'region', 'account', 'repository', 'prefix']
      .map((key) => [key, { type: 'string' }]));
    const { values } = parseArgs({ options });
    const result = await smoke(values);
    console.log(`ARM64 smoke passed. Worker ${result.worker} terminated, boot disk deleted, and runner registration removed.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
