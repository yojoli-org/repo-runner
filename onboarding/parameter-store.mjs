// Supply an authenticated, sandbox-scoped SSM PutParameter operation. Never
// overwrite another installation's parameters. Store the App ID last.
export async function saveAppParameters(putParameter, path, { appId, keyBase64, webhookSecret }) {
  if (typeof path !== 'string' || !/^\/repo-runner\/[a-z0-9][a-z0-9-]{0,62}$/.test(path)) {
    throw new Error('Invalid Repo Runner installation parameter path.');
  }
  for (const [suffix, Type, Value] of [
    ['app-key-base64', 'SecureString', keyBase64],
    ['webhook-secret', 'SecureString', webhookSecret],
    ['app-id', 'String', appId],
  ]) {
    try {
      await putParameter({ Name: `${path}/${suffix}`, Type, Value, Overwrite: false });
    } catch {
      throw new Error('Parameter write failed. Check installation parameter metadata before retrying.');
    }
  }
}
