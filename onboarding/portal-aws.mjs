import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { appParameterNames } from './parameter-store.mjs';
import { createPortalRegistrationHandlers } from './portal-registration.mjs';

const accountIdPattern = /^\d{12}$/;

export function createCustomerAws({ portalSts, scopedSts = (config) => new STSClient(config),
  scopedSsm = (config) => new SSMClient(config) }) {
  return async ({ accountId, region, path, roleArn, externalId }) => {
    if (typeof accountId !== 'string' || !accountIdPattern.test(accountId)
      || typeof region !== 'string' || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)
      || typeof roleArn !== 'string' || !roleArn.startsWith(`arn:aws:iam::${accountId}:role/`)
      || !/^[\w+=,.@/-]+$/.test(roleArn.slice(`arn:aws:iam::${accountId}:role/`.length))
      || typeof externalId !== 'string' || !/^[\w+=,.@:/-]{16,1224}$/.test(externalId)) {
      throw new Error('Invalid approved customer AWS destination.');
    }
    const names = appParameterNames(path);
    const resources = names.map((name) => `arn:aws:ssm:${region}:${accountId}:parameter${name}`);
    const { Credentials } = await portalSts.send(new AssumeRoleCommand({
      RoleArn: roleArn, ExternalId: externalId, RoleSessionName: 'repo-runner-registration', DurationSeconds: 900,
      Policy: JSON.stringify({ Version: '2012-10-17', Statement: [{
        Effect: 'Allow', Action: 'ssm:PutParameter',
        Resource: resources,
      }, {
        Effect: 'Allow', Action: 'kms:Encrypt', Resource: `arn:aws:kms:${region}:${accountId}:key/*`,
        Condition: { StringEquals: {
          'kms:ViaService': `ssm.${region}.amazonaws.com`,
          'kms:ResourceAliases': 'alias/aws/ssm',
          'kms:EncryptionContext:PARAMETER_ARN': resources.slice(0, 2),
        } },
      }] }),
    }));
    if (!Credentials?.AccessKeyId || !Credentials.SecretAccessKey || !Credentials.SessionToken) {
      throw new Error('AWS did not provide temporary role credentials.');
    }
    const config = { region, credentials: {
      accessKeyId: Credentials.AccessKeyId, secretAccessKey: Credentials.SecretAccessKey, sessionToken: Credentials.SessionToken,
    } };
    const sts = scopedSts(config);
    const ssm = scopedSsm(config);
    return {
      getCallerIdentity: () => sts.send(new GetCallerIdentityCommand({})),
      putParameter(input) {
        if (!names.includes(input.Name) || input.Overwrite !== false) {
          throw new Error('Parameter write is outside the approved installation.');
        }
        return ssm.send(new PutParameterCommand({ Name: input.Name, Value: input.Value,
          Type: input.Name === names[2] ? 'String' : 'SecureString', Overwrite: false, Tier: 'Standard' }));
      },
    };
  };
}

// Initialize once in the portal runtime, using its AWS execution role.
export async function createAwsPortalHandlers({ portalRegion, portalAccountId, ...options }, clients = {}) {
  const portalSts = clients.portalSts ?? new STSClient({ region: portalRegion });
  const caller = await portalSts.send(new GetCallerIdentityCommand({}));
  if (typeof portalAccountId !== 'string' || !accountIdPattern.test(portalAccountId) || caller.Account !== portalAccountId) {
    throw new Error('AWS caller does not match the portal account.');
  }
  const document = clients.document ?? DynamoDBDocumentClient.from(new DynamoDBClient({ region: portalRegion }));
  return createPortalRegistrationHandlers({
    ...options,
    dynamodb: { put: (input) => document.send(new PutCommand(input)), update: (input) => document.send(new UpdateCommand(input)) },
    customerAws: createCustomerAws({ portalSts, scopedSts: clients.scopedSts, scopedSsm: clients.scopedSsm }),
  });
}
