import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { appParameterNames } from './parameter-store.mjs';
import { createPortalLambda } from './portal-lambda.mjs';
import { createPortalRegistrationHandlers } from './portal-registration.mjs';
import { createSmokeJob } from './smoke-job.mjs';
import { createDeploymentState, deploymentResponse, validatedWebhook } from './deployment-state.mjs';

async function buildClient(region) {
  const { CodeBuildClient, StartBuildCommand, BatchGetBuildsCommand } = await import('@aws-sdk/client-codebuild');
  const client = new CodeBuildClient({ region });
  return {
    start: async (input) => (await client.send(new StartBuildCommand(input))).build?.id,
    read: async (id) => (await client.send(new BatchGetBuildsCommand({ ids: [id] }))).builds?.[0],
  };
}

async function deploymentClients(region) {
  const [{ CloudFormationClient, DescribeStacksCommand }, { CloudWatchLogsClient, GetLogEventsCommand }] =
    await Promise.all([import('@aws-sdk/client-cloudformation'), import('@aws-sdk/client-cloudwatch-logs')]);
  const cfn = new CloudFormationClient({ region });
  const logs = new CloudWatchLogsClient({ region });
  return {
    async readStack(name) {
      try {
        return (await cfn.send(new DescribeStacksCommand({ StackName: name }))).Stacks?.[0];
      } catch (error) {
        if (error.name === 'ValidationError' && /does not exist/.test(error.message)) return null;
        throw error;
      }
    },
    async readLogs(logGroupName, logStreamName) {
      const result = await logs.send(new GetLogEventsCommand({ logGroupName, logStreamName, limit: 70, startFromHead: false }));
      return (result.events ?? []).map(({ message }) => message ?? '');
    },
  };
}

export function createCustomerRegistrationLambda({ portalOrigin, accountId, region, tableName, sandbox, report },
  { sts = new STSClient({ region }), ssm = new SSMClient({ region }),
    document = DynamoDBDocumentClient.from(new DynamoDBClient({ region })), request = fetch,
    connectBuild = buildClient, connectDeployment = deploymentClients } = {}) {
  const { identity, app, prefix } = sandbox;
  if (typeof accountId !== 'string' || !/^\d{12}$/.test(accountId)
    || typeof region !== 'string' || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)
    || typeof prefix !== 'string' || !/^[a-z0-9][a-z0-9-]{1,23}$/.test(prefix)
    || typeof tableName !== 'string' || !tableName.startsWith(prefix + '-')) {
    throw new Error('Configure the customer account, region, and dedicated installation table.');
  }
  const webhookUrl = sandbox.deployment ? undefined : validatedWebhook(app.webhookUrl, region);
  const destination = { accountId, region, path: '/repo-runner/' + prefix };
  const names = appParameterNames(destination.path);
  const installation = { config: { organization: app.organization, appName: app.appName,
    homepage: app.homepage, redirectUrl: app.redirectUrl, webhookUrl,
    allowSmokeDispatch: app.allowSmokeDispatch }, destination };

  return createPortalLambda({
    portalOrigin, sandbox: { ...identity, installation }, smokeRoutes: Boolean(sandbox.smoke),
    deploymentRoute: Boolean(sandbox.deployment),
  }, async (options) => {
    const codebuild = sandbox.smoke || sandbox.deployment ? await connectBuild(region) : undefined;
    const readDeployment = sandbox.deployment ? createDeploymentState({
      ...sandbox.deployment, accountId, region, readBuild: codebuild.read, ...await connectDeployment(region),
    }) : undefined;
    const registration = createPortalRegistrationHandlers({
      ...options, tableName, report, request, verifiedAwsStep: 'customer_account_verified',
      ...(readDeployment && {
        async approvedInstallation() {
          const result = await readDeployment();
          if (result.state !== 'ready') return null;
          return { ...installation, config: { ...installation.config, webhookUrl: result.webhookUrl } };
        },
      }),
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
    });
    return {
      ...registration,
      ...(readDeployment && { deploymentStatus: async () => deploymentResponse((await readDeployment()).state) }),
      ...(sandbox.smoke && createSmokeJob({
        ...sandbox.smoke, origin: portalOrigin, prefix,
        codebuild,
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
    };
  });
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
