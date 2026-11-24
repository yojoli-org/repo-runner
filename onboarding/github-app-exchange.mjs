import { readRegistrationCallback } from './github-app-manifest.mjs';

// consumeAttempt must atomically claim the unexpired attempt for the current
// authenticated user. saveCredentials must use that attempt's approved AWS destination.
export async function completeRegistration({ query, attempt, consumeAttempt, saveCredentials, request = fetch, report = () => {} }) {
  const code = readRegistrationCallback(query, attempt.state);
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(code)) {
    throw new Error('Invalid GitHub App registration callback.');
  }
  if (!await consumeAttempt(attempt)) {
    throw new Error('GitHub App registration expired or was already used.');
  }

  let app;
  try {
    const response = await request(`https://api.github.com/app-manifests/${code}/conversions`, {
      method: 'POST',
      redirect: 'error',
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      report('github_exchange_rejected');
      throw new Error();
    }
    app = await response.json();
  } catch {
    report('github_exchange_failed');
    throw new Error('GitHub App exchange did not complete. Check the existing App before restarting registration.');
  }

  if (!app || !Number.isSafeInteger(app.id) || app.id <= 0
    || typeof app.slug !== 'string' || !/^[a-z0-9-]+$/.test(app.slug)
    || app.owner?.login?.toLowerCase() !== attempt.organization.toLowerCase()) {
    report('github_app_identity_unexpected');
    throw new Error('GitHub returned unexpected App details. Review the App before retrying.');
  }
  if (typeof app.pem !== 'string' || !app.pem.startsWith('-----BEGIN RSA PRIVATE KEY-----')) {
    report('github_app_key_unexpected');
    throw new Error('GitHub returned unexpected App details. Review the App before retrying.');
  }
  if (typeof app.webhook_secret !== 'string' || !app.webhook_secret.trim()) {
    report('github_app_webhook_secret_missing');
    throw new Error('GitHub returned unexpected App details. Review the App before retrying.');
  }

  try {
    await saveCredentials(attempt, {
      appId: String(app.id),
      keyBase64: Buffer.from(app.pem, 'utf8').toString('base64'),
      webhookSecret: app.webhook_secret,
    });
  } catch {
    report('github_app_storage_failed');
    throw new Error('GitHub App credentials could not be fully stored. Recover the existing App before retrying.');
  }
  return { appId: app.id, slug: app.slug };
}
