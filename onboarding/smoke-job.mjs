import { createHash } from 'node:crypto';

const json = (state, status = 200) => Response.json({ state }, { status,
  headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

export function createSmokeJob({ origin, prefix, project, sourceVersion, store, codebuild, now = Date.now }) {
  if (project !== prefix + '-verify' || !/^[A-Za-z0-9._/+=-]{1,1024}$/.test(sourceVersion ?? '')) {
    throw new Error('Configure a pinned smoke verification project for this runner pool.');
  }
  const id = 'smoke-' + createHash('sha256').update(prefix).digest('hex');
  const validBuild = (buildId) => typeof buildId === 'string'
    && buildId.startsWith(project + ':') && /^[a-f0-9-]{36}$/.test(buildId.slice(project.length + 1));

  async function status() {
    const job = await store.read(id);
    if (!job) return json('idle');
    if (!validBuild(job.buildId)) return json(now() - job.createdAt < 60000 ? 'starting' : 'unconfirmed');
    const build = await codebuild.read(job.buildId);
    if (!build || build.id !== job.buildId || build.projectName !== project || build.sourceVersion !== sourceVersion) {
      return json('unconfirmed');
    }
    if (build.buildStatus === 'SUCCEEDED' && build.buildComplete) return json('ready');
    if (build.buildStatus === 'IN_PROGRESS') return json('running');
    return json('failed');
  }

  return {
    smokeStatus: status,
    async startSmoke(request) {
      if (request.headers.get('origin') !== origin) return json('forbidden', 403);
      if (!await store.claim({ id, createdAt: now() })) return status();
      try {
        const buildId = await codebuild.start({ projectName: project, sourceVersion, idempotencyToken: id.slice(0, 64) });
        if (!validBuild(buildId)) return json('unconfirmed', 503);
        await store.setBuild(id, buildId);
        return json('running', 202);
      } catch {
        // A timeout can occur after AWS accepts StartBuild. Keep the claim.
        return json('unconfirmed', 503);
      }
    },
  };
}
