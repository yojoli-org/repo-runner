import { createAwsPortalHandlers } from './portal-aws.mjs';

const startPath = '/api/onboarding/github/start';
const callbackPath = '/api/onboarding/github/callback';
const safeHeaders = {
  'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
};
const failure = (statusCode, error) => ({ statusCode, headers: safeHeaders, body: JSON.stringify({ error }) });

// Expose only through API Gateway with a JWT authorizer on both routes and
// a resource policy limiting invocation to that gateway. Never log the event.
export function createPortalLambda({ portalOrigin, sandbox, ...awsOptions }, connect = createAwsPortalHandlers) {
  const origin = new URL(portalOrigin).origin;
  const { issuer, subject, tenantId, installation } = sandbox;
  if (!origin.startsWith('https://') || ![issuer, subject, tenantId].every((value) => typeof value === 'string' && value)) {
    throw new Error('Configure an HTTPS portal and an approved sandbox identity.');
  }
  const identity = { tenantId, userId: subject };
  let connected;

  return async (event) => {
    const method = event?.requestContext?.http?.method;
    const path = event?.rawPath;
    if (event?.version !== '2.0' || (path !== startPath && path !== callbackPath)) {
      return failure(404, 'Route not found.');
    }
    if (method !== (path === startPath ? 'POST' : 'GET')) return failure(405, 'Method not allowed.');
    const claims = event.requestContext.authorizer?.jwt?.claims;
    if (claims?.iss !== issuer || claims?.sub !== subject) return failure(403, 'This sandbox is not approved for your account.');

    try {
      connected ??= Promise.resolve().then(() => connect({
        ...awsOptions, portalOrigin: origin,
        authenticate: async () => identity,
        approvedInstallation: async () => installation,
      })).catch(() => {
        connected = undefined;
        throw new Error('Portal connection unavailable.');
      });
      const handlers = await connected;
      const url = new URL(path, origin);
      url.search = event.rawQueryString ?? '';
      const headers = new Headers();
      if (event.headers?.origin) headers.set('origin', event.headers.origin);
      const request = new Request(url, { method, headers });
      const response = await handlers[path === startPath ? 'start' : 'callback'](request);
      return { statusCode: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
    } catch {
      return failure(503, 'Portal registration is temporarily unavailable.');
    }
  };
}

let runtime;
export async function handler(event) {
  try {
    runtime ??= createPortalLambda({
      portalOrigin: process.env.PORTAL_ORIGIN,
      portalRegion: process.env.AWS_REGION,
      portalAccountId: process.env.PORTAL_AWS_ACCOUNT_ID,
      tableName: process.env.REGISTRATION_ATTEMPT_TABLE,
      sandbox: JSON.parse(process.env.PORTAL_SANDBOX_CONFIGURATION),
    });
    return await runtime(event);
  } catch {
    return failure(503, 'Portal registration is not configured.');
  }
}
