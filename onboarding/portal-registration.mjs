import { saveAppParameters } from './parameter-store.mjs';
import { createAttemptStore, finishAppRegistration, startAppRegistration } from './registration-attempts.mjs';

const responseHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const json = (body, status = 200) => Response.json(body, { status, headers: responseHeaders });

// Use a portal-account DynamoDB document client here. customerAws must return
// STS and SSM operations bound to the approved customer's role and region.
export function createPortalRegistrationHandlers({ portalOrigin, authenticate, approvedInstallation,
  tableName, dynamodb, customerAws, request, report = () => {} }) {
  const origin = new URL(portalOrigin).origin;
  if (!origin.startsWith('https://')) throw new Error('Configure an HTTPS portal origin.');
  const store = createAttemptStore({ tableName, put: (input) => dynamodb.put(input), update: (input) => dynamodb.update(input) });

  async function session(httpRequest) {
    const identity = await authenticate(httpRequest);
    if (typeof identity?.tenantId !== 'string' || !identity.tenantId
      || typeof identity.userId !== 'string' || !identity.userId) return null;
    return { tenantId: identity.tenantId, userId: identity.userId };
  }

  async function verifiedCustomerAws(destination) {
    const aws = await customerAws(destination);
    const caller = await aws.getCallerIdentity();
    if (!/^\d{12}$/.test(destination.accountId) || caller.Account !== destination.accountId) {
      throw new Error('AWS account does not match the approved installation.');
    }
    return aws;
  }

  return {
    async start(httpRequest) {
      if (httpRequest.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      if (httpRequest.headers.get('origin') !== origin) return json({ error: 'Unexpected request origin.' }, 403);
      try {
        const identity = await session(httpRequest);
        if (!identity) return json({ error: 'Sign in to start setup.' }, 401);
        const installation = await approvedInstallation(identity, httpRequest);
        if (!installation) return json({ error: 'Approve an installation first.' }, 403);
        if (new URL(installation.config.redirectUrl).origin !== origin) {
          throw new Error('Invalid portal callback origin.');
        }
        try {
          await verifiedCustomerAws(installation.destination);
        } catch (error) {
          if (error?.name !== 'AccessDenied' && error?.name !== 'AccessDeniedException') throw error;
          report('customer_role_preflight_denied');
          return json({ code: 'customer_aws_access_denied',
            error: 'The portal could not access the customer AWS account. Use customer-side setup.' }, 403);
        }
        return json(await startAppRegistration({
          identity, config: installation.config, destination: installation.destination, store,
        }));
      } catch {
        return json({ error: 'Could not start GitHub App registration.' }, 500);
      }
    },

    async callback(httpRequest) {
      if (httpRequest.method !== 'GET') return json({ error: 'Use GET.' }, 405);
      try {
        const identity = await session(httpRequest);
        if (!identity) return json({ error: 'Sign in as the person who started setup.' }, 401);
        const result = await finishAppRegistration({
          identity, query: new URL(httpRequest.url).searchParams, store, request, report,
          saveCredentials: async ({ destination }, credentials) => {
            const aws = await verifiedCustomerAws(destination);
            report('customer_role_assumed');
            await saveAppParameters((input) => aws.putParameter(input), destination.path, credentials);
          },
        });
        return json(result);
      } catch {
        return json({ error: 'Registration could not be completed. Check the existing App before trying again.' }, 409);
      }
    },
  };
}
