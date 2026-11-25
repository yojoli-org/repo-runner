import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSmokeJob } from './smoke-job.mjs';

const origin = 'https://portal.example.test';
const project = 'rr-test-verify';
const sourceVersion = 'pinned-version';
const buildId = project + ':a51de3a0-beef-4321-ae84-012345678901';
const post = (from = origin) => new Request(origin, { method: 'POST', headers: { origin: from } });

function fixture() {
  let record;
  let starts = 0;
  const build = { id: buildId, projectName: project, sourceVersion, buildStatus: 'IN_PROGRESS', buildComplete: false };
  const handlers = createSmokeJob({
    origin, prefix: 'rr-test', project, sourceVersion,
    store: {
      read: async () => record,
      async claim(item) {
        if (record) return false;
        record = item;
        return true;
      },
      async setBuild(_, id) { record.buildId = id; },
    },
    codebuild: {
      async start(input) {
        assert.equal(input.projectName, project);
        assert.equal(input.sourceVersion, sourceVersion);
        starts++;
        return buildId;
      },
      async read(id) {
        assert.equal(id, buildId);
        return build;
      },
    },
  });
  return { handlers, build, starts: () => starts };
}

test('claims one build and reports ready only for the exact completed pinned verifier', async () => {
  const { handlers, build, starts } = fixture();
  assert.deepEqual(await (await handlers.smokeStatus()).json(), { state: 'idle' });
  assert.equal((await handlers.startSmoke(post('https://other.example.test'))).status, 403);
  const responses = await Promise.all([handlers.startSmoke(post()), handlers.startSmoke(post())]);
  assert.ok(responses.some((r) => r.status === 202));
  assert.equal(starts(), 1);
  assert.deepEqual(await (await handlers.smokeStatus()).json(), { state: 'running' });
  Object.assign(build, { buildStatus: 'SUCCEEDED', buildComplete: true, sourceVersion: 'other' });
  assert.deepEqual(await (await handlers.smokeStatus()).json(), { state: 'unconfirmed' });
  build.sourceVersion = sourceVersion;
  assert.deepEqual(await (await handlers.smokeStatus()).json(), { state: 'ready' });
});
