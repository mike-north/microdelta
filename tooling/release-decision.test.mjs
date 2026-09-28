/**
 * Only a push of main whose commit is the merge of the latest reviewed Version
 * Packages PR is a release decision. Everything else prepares, never publishes.
 *
 * @see https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#push
 * @see https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit
 * @see https://docs.github.com/en/rest/pulls/pulls#list-pull-requests
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ReleaseDecisionError, decideRelease } from './release-decision.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = 'a'.repeat(40);
const repository = 'mike-north/microdelta';

/** A merged Changesets version PR in the trusted repository. */
function versionPull(overrides = {}) {
  return {
    number: 49,
    merged_at: '2026-09-28T10:00:00Z',
    merge_commit_sha: sha,
    base: { ref: 'main', repo: { full_name: repository } },
    head: { ref: 'changeset-release/main', repo: { full_name: repository } },
    ...overrides,
  };
}

/** The push facts GitHub supplies for a merge of the version PR. */
function releasePush(overrides = {}) {
  return {
    eventName: 'push',
    repository,
    ref: 'refs/heads/main',
    sha,
    associatedPulls: [versionPull()],
    mergedVersionPulls: [versionPull()],
    ...overrides,
  };
}

test('merging the latest Version Packages PR into main is the release decision', () => {
  assert.deepEqual(decideRelease(releasePush()), { publish: true, pullNumber: 49, reason: 'Version Packages PR #49 was merged as this main commit.' });
});

test('ordinary feature pushes to main never publish', () => {
  const feature = { ...versionPull({ number: 70 }), head: { ref: 'codex/feature', repo: { full_name: repository } } };
  assert.equal(decideRelease(releasePush({ associatedPulls: [feature] })).publish, false);
  assert.equal(decideRelease(releasePush({ associatedPulls: [] })).publish, false);
});

test('manual dispatch prepares a version PR but never publishes', () => {
  const decision = decideRelease(releasePush({ eventName: 'workflow_dispatch' }));
  assert.equal(decision.publish, false);
  assert.match(decision.reason, /only a push of the merged Version Packages PR publishes/u);
});

test('pull-request events and version-branch updates never publish', () => {
  assert.equal(decideRelease(releasePush({ eventName: 'pull_request' })).publish, false);
  assert.throws(() => decideRelease(releasePush({ ref: 'refs/heads/changeset-release/main' })), ReleaseDecisionError);
});

test('an open or unmerged version PR is not a release decision', () => {
  assert.equal(decideRelease(releasePush({ associatedPulls: [versionPull({ merged_at: null })] })).publish, false);
  assert.equal(decideRelease(releasePush({ associatedPulls: [versionPull({ merge_commit_sha: 'b'.repeat(40) })] })).publish, false);
});

test('a version branch from a fork or another base is not a release decision', () => {
  const fork = versionPull({ head: { ref: 'changeset-release/main', repo: { full_name: 'someone/microdelta' } } });
  const otherBase = versionPull({ base: { ref: 'next', repo: { full_name: repository } } });
  assert.equal(decideRelease(releasePush({ associatedPulls: [fork] })).publish, false);
  assert.equal(decideRelease(releasePush({ associatedPulls: [otherBase] })).publish, false);
});

test('another repository is refused before any decision', () => {
  assert.throws(() => decideRelease(releasePush({ repository: 'someone/microdelta' })), /only mike-north\/microdelta may publish/u);
});

test('re-running an older release after a newer version merge is refused as stale', () => {
  const newer = versionPull({ number: 80, merged_at: '2026-10-01T10:00:00Z', merge_commit_sha: 'c'.repeat(40) });
  assert.throws(
    () => decideRelease(releasePush({ mergedVersionPulls: [versionPull(), newer] })),
    /stale release: Version Packages PR #80 was merged after #49/u,
  );
});

test('a release commit missing from the merged version PR list fails closed', () => {
  assert.throws(() => decideRelease(releasePush({ mergedVersionPulls: [] })), /could not confirm #49 as the latest merged Version Packages PR/u);
});

/** Serve the two read-only GitHub endpoints the CLI consults. */
async function withGitHub(routes, run) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    const body = routes(new URL(request.url, 'http://localhost'));
    response.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body ?? { message: 'Not Found' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

/** Run the CLI exactly as the workflow does, with GitHub's standard variables. */
async function cli(apiUrl, env) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-release-decision-'));
  const output = path.join(directory, 'output');
  try {
    const child = spawn(process.execPath, [path.join(root, 'tooling/release-decision.mjs')], {
      env: {
        PATH: process.env.PATH,
        GITHUB_API_URL: apiUrl,
        GITHUB_REPOSITORY: repository,
        GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: sha,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_TOKEN: 'read-only-test-token',
        GITHUB_OUTPUT: output,
        ...env,
      },
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const status = await new Promise(resolve => child.on('close', resolve));
    const written = await readFile(output, 'utf8').catch(() => '');
    return { status, stderr, output: written };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('CLI reads GitHub facts with the job token and writes the publish output', async () => {
  await withGitHub(url => {
    if (url.pathname === `/repos/${repository}/commits/${sha}/pulls`) return [versionPull()];
    if (url.pathname === `/repos/${repository}/pulls`) return [versionPull()];
    return undefined;
  }, async (apiUrl, requests) => {
    const result = await cli(apiUrl, {});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.output, /^publish=true$/mu);
    assert.match(result.output, /^pull=49$/mu);
    assert.ok(requests.every(request => request.authorization === 'Bearer read-only-test-token'));
    const list = requests.find(request => request.url.startsWith(`/repos/${repository}/pulls?`));
    assert.match(list.url, /head=mike-north%3Achangeset-release%2Fmain/u);
    assert.match(list.url, /state=closed/u);
  });
});

test('CLI does not consult GitHub for a manual dispatch and outputs no publication', async () => {
  await withGitHub(() => undefined, async (apiUrl, requests) => {
    const result = await cli(apiUrl, { GITHUB_EVENT_NAME: 'workflow_dispatch' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.output, /^publish=false$/mu);
    assert.equal(requests.length, 0);
  });
});

test('CLI fails closed when GitHub cannot be read', async () => {
  await withGitHub(() => undefined, async apiUrl => {
    const result = await cli(apiUrl, {});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /GitHub API .* returned 404/u);
    assert.doesNotMatch(result.output, /publish=true/u);
  });
});

test('missing Actions event metadata fails closed with a named diagnostic', async () => {
  await withGitHub(() => undefined, async apiUrl => {
    for (const variable of ['GITHUB_EVENT_NAME', 'GITHUB_REPOSITORY', 'GITHUB_REF']) {
      const result = await cli(apiUrl, { [variable]: '' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`${variable} is required`, 'u'));
      assert.doesNotMatch(result.output, /publish=true/u);
    }
  });
});
