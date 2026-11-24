const api = 'https://api.github.com';

// All expectations and the App JWT come from the approved server-side setup
// record. An installation callback can nominate an ID, but cannot grant access.
export async function verifyInstallationScope({ appId, installationId, repository, appJwt, request = fetch }) {
  if (![appId, installationId].every((id) => Number.isSafeInteger(id) && id > 0)
    || typeof repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repository)
    || typeof appJwt !== 'string' || !appJwt) {
    throw new Error('Invalid GitHub installation verification inputs.');
  }

  async function getJson(path, token, body) {
    try {
      const response = await request(`${api}${path}`, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch {
      throw new Error('GitHub installation scope could not be verified.');
    }
  }

  const installation = await getJson(`/app/installations/${installationId}`, appJwt);
  const owner = repository.split('/')[0].toLowerCase();
  if (installation?.id !== installationId || installation.app_id !== appId
    || installation.target_type !== 'Organization' || installation.suspended_at !== null
    || installation.repository_selection !== 'selected'
    || typeof installation.account?.login !== 'string' || installation.account.login.toLowerCase() !== owner) {
    throw new Error('Install the approved App for selected repositories in the expected organization.');
  }

  // Do not narrow repository IDs at mint time: that would hide extra grants.
  // Limit token permissions to metadata so verification cannot administer repos.
  const access = await getJson(`/app/installations/${installationId}/access_tokens`, appJwt,
    { permissions: { metadata: 'read' } });
  if (typeof access?.token !== 'string' || !access.token) {
    throw new Error('GitHub installation scope could not be verified.');
  }
  const listing = await getJson('/installation/repositories?per_page=2', access.token);
  const selected = listing?.repositories?.[0];
  if (listing?.total_count !== 1 || !Array.isArray(listing.repositories) || listing.repositories.length !== 1
    || selected?.private !== true || typeof selected.full_name !== 'string'
    || selected.full_name.toLowerCase() !== repository.toLowerCase()) {
    throw new Error('Limit the GitHub App installation to the approved private pilot repository.');
  }
  return { installationId, repository: selected.full_name };
}
