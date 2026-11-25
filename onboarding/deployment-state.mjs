export function validatedWebhook(value, region) {
  const webhook = new URL(value);
  const apiId = webhook.hostname.split('.')[0];
  if (!/^[a-z0-9]+$/.test(apiId)
    || webhook.href !== `https://${apiId}.execute-api.${region}.amazonaws.com/webhook`) {
    throw new Error('Configure the deployed customer webhook URL.');
  }
  return webhook.href;
}

export function createDeploymentState({ stack, sourceVersion, accountId, region, readStack, readBuild, readLogs }) {
  if (!/^rr-[a-z0-9-]{1,80}$/.test(stack ?? '') || !/^[A-Za-z0-9._/+=-]{1,1024}$/.test(sourceVersion ?? '')) {
    throw new Error('Configure the exact approved stack and deployment source version.');
  }
  const stackPrefix = `arn:aws:cloudformation:${region}:${accountId}:stack/${stack}/`;

  return async () => {
    const current = await readStack(stack);
    if (!current || current.StackStatus === 'REVIEW_IN_PROGRESS') return { state: 'awaiting_approval' };
    if (current.StackName !== stack || !current.StackId?.startsWith(stackPrefix)) return { state: 'unconfirmed' };
    if (current.StackStatus === 'CREATE_IN_PROGRESS') return { state: 'deploying' };
    if (current.StackStatus !== 'CREATE_COMPLETE' && current.StackStatus !== 'UPDATE_COMPLETE') return { state: 'failed' };

    const id = current.Outputs?.find(({ OutputKey }) => OutputKey === 'BuildId')?.OutputValue;
    if (!id?.startsWith(stack + ':') || !/^[a-f0-9-]{36}$/.test(id.slice(stack.length + 1))) return { state: 'unconfirmed' };
    const build = await readBuild(id);
    if (!build || build.id !== id || build.projectName !== stack || build.sourceVersion !== sourceVersion) {
      return { state: 'unconfirmed' };
    }
    if (build.buildStatus === 'IN_PROGRESS') return { state: 'deploying' };
    if (build.buildStatus !== 'SUCCEEDED' || build.buildComplete !== true) return { state: 'failed' };
    const group = '/repo-runner/bootstrap/' + stack;
    if (build.logs?.groupName !== group || build.logs.streamName !== 'proof/' + id.slice(stack.length + 1)) {
      return { state: 'unconfirmed' };
    }
    const logs = await readLogs(group, build.logs.streamName);
    const endpoints = logs.flatMap((line) => [...line.matchAll(/^webhook_endpoint = "(https:\/\/[a-z0-9.-]+\/webhook)"\s*$/gm)]
      .map((match) => match[1]));
    if (endpoints.length !== 1) return { state: 'unconfirmed' };
    try {
      return { state: 'ready', webhookUrl: validatedWebhook(endpoints[0], region) };
    } catch {
      return { state: 'unconfirmed' };
    }
  };
}

export const deploymentResponse = (state, status = 200) => Response.json({ state }, { status,
  headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
