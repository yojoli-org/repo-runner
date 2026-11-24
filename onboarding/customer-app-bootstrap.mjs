import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { paginateDescribeParameters, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { completeRegistration } from './github-app-exchange.mjs';
import { createRegistration } from './github-app-manifest.mjs';
import { appParameterNames, saveAppParameters } from './parameter-store.mjs';

const escapeHtml = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function customerSession(profile, region) {
  const sts = new STSClient({ profile, region });
  const ssm = new SSMClient({ profile, region });
  return {
    async account() {
      return (await sts.send(new GetCallerIdentityCommand({}))).Account;
    },
    async hasAppParameters(path, names) {
      for await (const page of paginateDescribeParameters({ client: ssm }, {
        ParameterFilters: [{ Key: 'Name', Option: 'BeginsWith', Values: [path + '/'] }],
      })) {
        if (page.Parameters?.some(({ Name }) => names.includes(Name))) return true;
      }
      return false;
    },
    putParameter(input) {
      return ssm.send(new PutParameterCommand({ ...input, Tier: 'Standard' }));
    },
  };
}

export async function bootstrap({ profile, region, account, organization, appName, homepage, path },
  { aws = customerSession(profile, region), request = fetch, announce = console.log, timeoutMs = 600000 } = {}) {
  const names = appParameterNames(path);
  if (!profile || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region ?? '') || !/^\d{12}$/.test(account ?? '')) {
    throw new Error('Provide an AWS profile, region, and expected account ID.');
  }

  const checkAccount = async () => {
    if (await aws.account().catch(() => {
      throw new Error('Could not verify the selected AWS profile. Check its login and region.');
    }) !== account) {
      throw new Error('AWS profile points to a different account.');
    }
  };
  await checkAccount();
  const occupied = await aws.hasAppParameters(path, names).catch(() => {
    throw new Error('Could not check Parameter Store metadata in the verified account.');
  });
  if (occupied) {
    throw new Error('The installation parameter path is in use. Review its metadata before retrying.');
  }

  const start = '/' + randomBytes(24).toString('hex');
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const host = `127.0.0.1:${server.address().port}`;
    const origin = `http://${host}`;
    const registration = createRegistration({
      organization, appName, homepage, redirectUrl: origin + '/callback', localCallback: true,
    });
    let claimed = false;

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('GitHub approval timed out. Check for an existing App.')), timeoutMs);
      const finish = (done, value) => {
        clearTimeout(timer);
        done(value);
      };

      server.on('request', async (message, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Content-Security-Policy', "default-src 'none'; form-action https://github.com; frame-ancestors 'none'");
        if (message.method !== 'GET' || message.headers.host !== host || !message.url?.startsWith('/')) {
          response.writeHead(404).end();
          return;
        }
        if (message.url === start) {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
            '<!doctype html><title>Repo Runner GitHub setup</title><h1>Connect GitHub</h1>' +
            `<p>GitHub will ask you to create a private App for ${escapeHtml(organization)}.</p>` +
            `<form method="post" action="${escapeHtml(registration.action)}">` +
            `<input type="hidden" name="manifest" value="${escapeHtml(registration.fields.manifest)}">` +
            '<button>Continue to GitHub</button></form>',
          );
          return;
        }
        const url = new URL(origin + message.url);
        if (url.pathname !== '/callback' || url.searchParams.get('state') !== registration.state || claimed) {
          response.writeHead(404).end();
          return;
        }
        try {
          const result = await completeRegistration({
            query: url.searchParams, attempt: { state: registration.state, organization }, request,
            consumeAttempt: () => {
              claimed = true;
              clearTimeout(timer);
              return true;
            },
            saveCredentials: async (_, credentials) => {
              await checkAccount();
              await saveAppParameters((input) => aws.putParameter(input), path, credentials);
            },
          });
          response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(
            'GitHub App credentials saved. Return to the installer.',
          );
          finish(resolve, result);
        } catch (error) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(
            'GitHub App setup did not complete. Return to the installer for details.',
          );
          finish(reject, error);
        }
      });
      announce(origin + start);
    });
  } finally {
    server.close();
    server.closeIdleConnections();
  }
}

if (import.meta.main) {
  try {
    const options = Object.fromEntries(
      ['profile', 'region', 'account', 'organization', 'app-name', 'homepage', 'path']
        .map((name) => [name, { type: 'string' }]),
    );
    const { values } = parseArgs({ options });
    const { slug } = await bootstrap({ ...values, appName: values['app-name'] }, {
      announce: (url) => console.log('Open this setup link on this machine to approve GitHub App creation:\n' + url),
    });
    console.log(`Credentials saved. Install the App on the approved test repository only: https://github.com/apps/${slug}/installations/new`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
