import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { appParameterNames } from './parameter-store.mjs';
import { createPortalLambda } from './portal-lambda.mjs';
import { createPortalRegistrationHandlers } from './portal-registration.mjs';

export function createCustomerRegistrationLambda({ portalOrigin, accountId, region, tableName, sandbox, report },
  { sts = new STSClient({ region }), ssm = new SSMClient({ region }),
    document = DynamoDBDocumentClient.from(new DynamoDBClient({ region })), request = fetch } = {}) {
  const { identity, app, prefix } = sandbox;
  if (typeof accountId !== 'string' || !/^\d{12}$/.test(accountId)
    || typeof region !== 'string' || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)
    || typeof prefix !== 'string' || !/^[a-z0-9][a-z0-9-]{1,23}$/.test(prefix)
    || typeof tableName !== 'string' || !tableName.startsWith(prefix + '-')) {
    throw new Error('Configure the customer account, region, and dedicated installation table.');
  }
  const webhook = new URL(app.webhookUrl);
  const apiId = webhook.hostname.split('.')[0];
  if (!/^[a-z0-9]+$/.test(apiId)
    || webhook.href !== `https://${apiId}.execute-api.${region}.amazonaws.com/webhook`) {
    throw new Error('Configure the deployed customer webhook URL.');
  }
  const destination = { accountId, region, path: '/repo-runner/' + prefix };
  const names = appParameterNames(destination.path);
  const installation = { config: { organization: app.organization, appName: app.appName,
    homepage: app.homepage, redirectUrl: app.redirectUrl, webhookUrl: webhook.href }, destination };

  return createPortalLambda({
    portalOrigin, sandbox: { ...identity, installation },
  }, async (options) => createPortalRegistrationHandlers({
    ...options, tableName, report, request, verifiedAwsStep: 'customer_account_verified',
    dynamodb: {
      put: (input) => document.send(new PutCommand(input)),
      update: (input) => document.send(new UpdateCommand(input)),
    },
    async customerAws(approved) {
      if (approved?.accountId !== accountId || approved?.region !== region || approved?.path !== destination.path) {
        throw new Error('The attempt does not match the approved customer installation.');
      }
      return {
        getCallerIdentity: () => sts.send(new GetCallerIdentityCommand({})),
        putParameter({ Name, Value, Overwrite }) {
          if (!names.includes(Name) || Overwrite !== false) {
            throw new Error('The parameter is outside the approved customer installation.');
          }
          const Type = Name === names[2] ? 'String' : 'SecureString';
          return ssm.send(new PutParameterCommand({ Name, Value, Type, Overwrite: false, Tier: 'Standard' }));
        },
      };
    },
  }));
}

let runtime;
export async function handler(event) {
  try {
    runtime ??= createCustomerRegistrationLambda({
      portalOrigin: process.env.PORTAL_ORIGIN,
      accountId: process.env.CUSTOMER_AWS_ACCOUNT_ID,
      region: process.env.AWS_REGION,
      tableName: process.env.REGISTRATION_ATTEMPT_TABLE,
      sandbox: JSON.parse(process.env.CUSTOMER_REGISTRATION_CONFIGURATION),
    });
    return await runtime(event);
  } catch {
    return {
      statusCode: 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
      body: JSON.stringify({ error: 'Customer registration is not configured.' }),
    };
  }
}
