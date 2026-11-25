import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { appParameterNames } from './parameter-store.mjs';
import { createPortalLambda } from './portal-lambda.mjs';
import { createPortalRegistrationHandlers } from './portal-registration.mjs';
import { createSmokeJob } from './smoke-job.mjs';

async function buildClient(region) {
  const { CodeBuildClient, StartBuildCommand, BatchGetBuildsCommand } = await import('@aws-sdk/client-codebuild');
  const client = new CodeBuildClient({ region });
  return {
    start: async (input) => (await client.send(new StartBuildCommand(input))).build?.id,
    read: async (id) => (await client.send(new BatchGetBuildsCommand({ ids: [id] }))).builds?.[0],
  };
}

export function createCustomerRegistrationLambda({ portalOrigin, accountId, region, tableName, sandbox, report },
  { sts = new STSClient({ region }), ssm = new SSMClient({ region }),
    document = DynamoDBDocumentClient.from(new DynamoDBClient({ region })), request = fetch,
    connectBuild = buildClient } = {}) {
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
    homepage: app.homepage, redirectUrl: app.redirectUrl, webhookUrl: webhook.href,
    allowSmokeDispatch: app.allowSmokeDispatch }, destination };

  return createPortalLambda({
    portalOrigin, sandbox: { ...identity, installation }, smokeRoutes: Boolean(sandbox.smoke),
  }, async (options) => ({
    ...createPortalRegistrationHandlers({
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
    }),
    ...(sandbox.smoke && createSmokeJob({
      ...sandbox.smoke, origin: portalOrigin, prefix,
      codebuild: await connectBuild(region),
      store: {
        read: async (id) => (await document.send(new GetCommand({
          TableName: tableName, Key: { id }, ConsistentRead: true,
        }))).Item,
        async claim(item) {
          try {
            await document.send(new PutCommand({
              TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(id)',
            }));
            return true;
          } catch (error) {
            if (error.name === 'ConditionalCheckFailedException') return false;
            throw error;
          }
        },
        setBuild: (id, buildId) => document.send(new UpdateCommand({
          TableName: tableName, Key: { id }, ConditionExpression: 'attribute_exists(id) AND attribute_not_exists(buildId)',
          UpdateExpression: 'SET buildId = :build', ExpressionAttributeValues: { ':build': buildId },
        })),
      },
    })),
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
