import { createHash } from 'node:crypto';
import { completeRegistration } from './github-app-exchange.mjs';
import { createRegistration } from './github-app-manifest.mjs';

const keyFor = (state) => createHash('sha256').update(state).digest('hex');

// Inject DynamoDB document-client operations. The table uses a string `id`
// partition key and numeric `expiresAt` TTL. No credentials are stored here.
export function createAttemptStore({ tableName, put, update, now = () => Math.floor(Date.now() / 1000) }) {
  return {
    async start({ tenantId, userId, registration, destination }) {
      await put({
        TableName: tableName,
        Item: { id: keyFor(registration.state), tenantId, userId, organization: registration.organization,
          destination, expiresAt: now() + 600 },
        ConditionExpression: 'attribute_not_exists(id)',
      });
    },
    async claim({ state, tenantId, userId }) {
      try {
        const { Attributes } = await update({
          TableName: tableName,
          Key: { id: keyFor(state) },
          UpdateExpression: 'SET claimedAt = :now',
          ConditionExpression: 'tenantId = :tenant AND userId = :user AND expiresAt > :now AND attribute_not_exists(claimedAt)',
          ExpressionAttributeValues: { ':tenant': tenantId, ':user': userId, ':now': now() },
          ReturnValues: 'ALL_NEW',
        });
        return Attributes;
      } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') return null;
        throw new Error('Could not claim the registration attempt.');
      }
    },
  };
}

// The HTTP layer must supply identity from the authenticated session and the
// destination from an approved installation record, never from query inputs.
export async function startAppRegistration({ identity, config, destination, store }) {
  const registration = createRegistration(config);
  await store.start({ ...identity, registration: { state: registration.state, organization: config.organization }, destination });
  return { action: registration.action, fields: registration.fields };
}

export async function finishAppRegistration({ identity, query, store, saveCredentials, request, report = () => {} }) {
  const states = query.getAll('state');
  const codes = query.getAll('code');
  if (states.length !== 1 || !/^[a-f0-9]{64}$/.test(states[0])
    || codes.length !== 1 || !/^[A-Za-z0-9_-]{1,256}$/.test(codes[0])) {
    throw new Error('Invalid GitHub App registration callback.');
  }
  const claimed = await store.claim({ ...identity, state: states[0] });
  if (!claimed) throw new Error('GitHub App registration expired or was already used.');
  report('registration_attempt_claimed');

  return completeRegistration({
    query,
    attempt: { ...claimed, state: states[0] },
    // The durable claim above supplies the organization and AWS destination.
    consumeAttempt: async () => true,
    saveCredentials,
    request,
    report,
  });
}
