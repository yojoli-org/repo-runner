const parameterSuffixes = ['app-key-base64', 'webhook-secret', 'app-id'];

export function appParameterNames(path) {
  if (typeof path !== 'string' || !/^\/repo-runner\/[a-z0-9][a-z0-9-]{0,62}$/.test(path)) {
    throw new Error('Invalid Repo Runner installation parameter path.');
  }
  return parameterSuffixes.map((suffix) => `${path}/${suffix}`);
}

// Store the App ID last and never overwrite another installation's parameters.
export async function saveAppParameters(putParameter, path, { appId, keyBase64, webhookSecret }) {
  const [keyName, webhookName, appIdName] = appParameterNames(path);
  for (const [Name, Type, Value] of [
    [keyName, 'SecureString', keyBase64],
    [webhookName, 'SecureString', webhookSecret],
    [appIdName, 'String', appId],
  ]) {
    try {
      await putParameter({ Name, Type, Value, Overwrite: false });
    } catch {
      throw new Error('Parameter write failed. Check installation parameter metadata before retrying.');
    }
  }
}
