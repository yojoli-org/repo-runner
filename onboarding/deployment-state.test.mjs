import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeploymentState, deploymentResponse } from './deployment-state.mjs';

const stack = 'rr-test';
const accountId = '123456789012';
const region = 'us-east-2';
const sourceVersion = 'approved-version';
const suffix = 'dcf8291b-30f8-4978-976a-3aec45ec48cb';
const id = stack + ':' + suffix;
const groupName = '/repo-runner/bootstrap/' + stack;
const streamName = 'proof/' + suffix;
const webhookUrl = 'https://test123.execute-api.us-east-2.amazonaws.com/webhook';
const stackResult = {
  StackName: stack, StackId: 'arn:aws:cloudformation:us-east-2:123456789012:stack/rr-test/fixture',
  StackStatus: 'CREATE_COMPLETE', Outputs: [{ OutputKey: 'BuildId', OutputValue: id }],
};
const buildResult = {
  projectName: stack, id, sourceVersion, buildStatus: 'SUCCEEDED', buildComplete: true,
  logs: { groupName, streamName },
};
const line = 'webhook_endpoint = "' + webhookUrl + '"';
const reader = (overrides = {}) => createDeploymentState({
  stack, accountId, region, sourceVersion,
  readStack: async (name) => { assert.equal(name, stack); return stackResult; },
  readBuild: async (buildId) => { assert.equal(buildId, id); return buildResult; },
  readLogs: async (...args) => { assert.deepEqual(args, [groupName, streamName]); return [line]; },
  ...overrides,
});

test('uses the exact successful deployment and keeps the webhook internal', async () => {
  const result = await reader()();
  assert.deepEqual(result, { state: 'ready', webhookUrl });
  assert.deepEqual(await deploymentResponse(result.state).json(), { state: 'ready' });
});

test('distinguishes approval, build progress, and failure', async () => {
  assert.deepEqual(await reader({ readStack: async () => undefined })(), { state: 'awaiting_approval' });
  for (const [buildStatus, state] of [['IN_PROGRESS', 'deploying'], ['FAILED', 'failed']]) {
    assert.deepEqual(await reader({ readBuild: async () => ({ ...buildResult, buildStatus }) })(), { state });
  }
});

test('refuses mismatched or ambiguous deployment evidence', async () => {
  for (const build of [{ sourceVersion: 'other' }, { logs: { groupName, streamName: 'proof/other' } }]) {
    assert.deepEqual(await reader({ readBuild: async () => ({ ...buildResult, ...build }) })(), { state: 'unconfirmed' });
  }
  for (const lines of [[], [line, line], [line.replace('us-east-2', 'us-east-1')]]) {
    assert.deepEqual(await reader({ readLogs: async () => lines })(), { state: 'unconfirmed' });
  }
});
