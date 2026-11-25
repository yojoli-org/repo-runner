import assert from 'node:assert/strict';
import test from 'node:test';
import { smoke } from './pilot-smoke.mjs';

const config = {
  profile: 'customer-test', region: 'us-east-2', account: '123456789012',
  repository: 'example-org/private', prefix: 'rr-test',
};
const url = 'https://github.com/example-org/private/actions/runs/123';
const instance = 'i-123';
const disk = 'vol-123';

function fixture() {
  let clock = 0;
  let workerChecks = 0;
  let volumeChecks = 0;
  const cancellations = [];
  const io = {
    account: () => config.account,
    repo: () => ({ private: true, full_name: config.repository, default_branch: 'main' }),
    queueReady: () => true,
    workers() {
      workerChecks++;
      if (workerChecks === 1) return [];
      return [{
        InstanceId: instance, Architecture: 'arm64', LaunchTime: new Date(0).toISOString(),
        State: { Name: workerChecks === 2 ? 'running' : 'terminated' },
        BlockDeviceMappings: workerChecks === 2 ? [{ Ebs: { VolumeId: disk } }] : [],
      }];
    },
    volumes(ids) {
      assert.deepEqual(ids, [disk]);
      return ++volumeChecks === 1 ? [disk] : [];
    },
    runners: () => 0,
    pending: () => false,
    dispatch: (ref) => {
      assert.equal(ref, 'main');
      return url;
    },
    run(id) {
      assert.equal(id, '123');
      return clock < 5000 ? { status: 'queued' } : { status: 'completed', conclusion: 'success' };
    },
    jobs: () => ({ total_count: 1, jobs: [{
      runner_name: instance, conclusion: 'success',
      steps: [{ name: 'Check native ARM64 Linux execution', conclusion: 'success' }],
    }] }),
    cancel: (id) => cancellations.push(id),
  };
  return {
    io, cancellations, now: () => clock, pause: async (ms) => { clock += ms; },
    report: () => {}, cleanupTimeoutMs: 20000,
  };
}

test('waits for the exact ARM64 smoke worker and remembered volume to be cleaned up', async () => {
  const options = fixture();
  assert.deepEqual(await smoke(config, options), { runId: '123', worker: instance, volumes: [disk] });
  assert.equal(options.now(), 10000);
  assert.deepEqual(options.cancellations, []);
});

test('cancels the exact run on timeout and checks cleanup before failing', async () => {
  const options = fixture();
  options.jobTimeoutMs = 0;
  await assert.rejects(smoke(config, options), /did not pass.*gone/);
  assert.deepEqual(options.cancellations, ['123']);
  assert.equal(options.now(), 10000);
});

test('refuses to dispatch if the repo has an existing runner or AWS account mismatch', async () => {
  const options = fixture();
  options.io.dispatch = () => assert.fail('Should not dispatch');
  options.io.runners = () => 1;
  await assert.rejects(smoke(config, options), /zero active workers/);
  options.io.account = () => '999999999999';
  await assert.rejects(smoke(config, options), /different account/);
});

test('fails when the run passed but worker attribution is missing', async () => {
  const options = fixture();
  options.io.jobs = () => ({ total_count: 1, jobs: [{ runner_name: 'other-runner', conclusion: 'success' }] });
  await assert.rejects(smoke(config, options), /could not be verified/);
});
