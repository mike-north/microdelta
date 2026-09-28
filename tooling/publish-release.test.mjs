/**
 * Publication consumes only verified release artifacts, checks the registry for
 * every package before its first side effect, and resumes safely after a
 * partial run. Immediately before the registry plan and before each publish it
 * re-reads GitHub to confirm this run is still the latest release decision, so
 * a run that waited while a newer Version Packages PR merged cannot publish.
 * A fake `npm` on PATH stands in for the registry and a local HTTP server for
 * GitHub: these tests never contact or write to npm or GitHub.
 *
 * @see https://docs.npmjs.com/trusted-publishers
 * @see https://docs.npmjs.com/cli/v11/commands/npm-publish
 * @see https://docs.npmjs.com/cli/v11/commands/npm-view
 * @see https://docs.npmjs.com/cli/v11/commands/npm-dist-tag
 * @see https://semver.org/#spec-item-11
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareVersions } from './publish-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = 'd'.repeat(40);
const repository = 'mike-north/microdelta';

/** A merged Changesets version PR; `number` 49 is the release under test. */
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

/** A later Version Packages merge that makes release #49 stale. */
const newerRelease = versionPull({ number: 80, merged_at: '2026-09-28T11:00:00Z', merge_commit_sha: 'c'.repeat(40) });

/**
 * Fake GitHub REST endpoints used by the release decision. `mergedPulls`
 * may be replaced by a function of the list-request count to model a newer
 * release merging while this run is waiting or publishing.
 */
const github = { url: '', associated: [], mergedPulls: [], failStatus: 0, listRequests: 0, server: undefined };

before(async () => {
  github.server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    let body;
    if (github.failStatus !== 0) body = undefined;
    else if (url.pathname === `/repos/${repository}/commits/${sha}/pulls`) body = github.associated;
    else if (url.pathname === `/repos/${repository}/pulls`) {
      github.listRequests += 1;
      body = typeof github.mergedPulls === 'function' ? github.mergedPulls(github.listRequests) : github.mergedPulls;
    }
    response.writeHead(body === undefined ? (github.failStatus || 404) : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body ?? { message: 'unavailable' }));
  });
  await new Promise(resolve => github.server.listen(0, '127.0.0.1', resolve));
  github.url = `http://127.0.0.1:${github.server.address().port}`;
});

after(async () => {
  await new Promise(resolve => github.server.close(resolve));
});

beforeEach(() => {
  github.associated = [versionPull()];
  github.mergedPulls = [versionPull()];
  github.failStatus = 0;
  github.listRequests = 0;
});

/** npm's Subresource Integrity form for tarball bytes. */
function integrity(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/**
 * Fake npm: `--version`, `view <spec> dist.integrity --json` answered from a
 * registry JSON file, and `publish` recorded (and optionally failed) without
 * any network access.
 */
const fakeNpm = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const registry = JSON.parse(fs.readFileSync(process.env.FAKE_REGISTRY, 'utf8'));
fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({ args, token: process.env.NODE_AUTH_TOKEN ?? null }) + '\\n');
if (args[0] === '--version') { process.stdout.write((process.env.FAKE_NPM_VERSION || '11.6.2') + '\\n'); process.exit(0); }
if (args[0] === 'view' && args[2] === 'dist-tags.latest') {
  const entry = registry[args[1]];
  if (entry === 'error') { process.stdout.write(JSON.stringify({ error: { code: 'E500', summary: 'registry unavailable' } })); process.exit(1); }
  if (entry === undefined) { process.stdout.write(JSON.stringify({ error: { code: 'E404', summary: 'Not Found' } })); process.exit(1); }
  if (entry['$latest'] === 'error') { process.stdout.write(JSON.stringify({ error: { code: 'E500', summary: 'registry unavailable' } })); process.exit(1); }
  if (entry['$latest'] !== undefined) process.stdout.write(JSON.stringify(entry['$latest']));
  process.exit(0);
}
if (args[0] === 'view') {
  const spec = args[1];
  const name = spec.slice(0, spec.lastIndexOf('@'));
  const entry = registry[name];
  if (entry === 'error') { process.stdout.write(JSON.stringify({ error: { code: 'E500', summary: 'registry unavailable' } })); process.exit(1); }
  if (entry === undefined) { process.stdout.write(JSON.stringify({ error: { code: 'E404', summary: 'Not Found' } })); process.exit(1); }
  const version = spec.slice(spec.lastIndexOf('@') + 1);
  if (entry[version] === undefined) process.exit(0);
  process.stdout.write(JSON.stringify(entry[version]));
  process.exit(0);
}
if (args[0] === 'publish') {
  const tarball = args[1];
  if (process.env.FAKE_FAIL_PUBLISH && tarball.includes(process.env.FAKE_FAIL_PUBLISH)) { process.stderr.write('E403 simulated publish failure\\n'); process.exit(1); }
  const [name, version, value] = JSON.parse(fs.readFileSync(tarball + '.meta', 'utf8'));
  registry[name] = { ...(registry[name] === undefined ? {} : registry[name]), [version]: value, '$latest': version };
  fs.writeFileSync(process.env.FAKE_REGISTRY, JSON.stringify(registry));
  process.exit(0);
}
process.stderr.write('unexpected npm invocation ' + args.join(' ') + '\\n');
process.exit(2);
`;

/** A release directory shaped like the package job's uploaded artifact. */
async function releaseFixture(packages = [
  ['@microdelta/machine', '0.1.0'],
  ['@microdelta/value', '0.1.0'],
  ['microdelta', '0.0.1'],
]) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-publish-'));
  const entries = [];
  for (const [name, version] of packages) {
    const tarball = `${name.replace('@', '').replace('/', '-')}-${version}.tgz`;
    const bytes = Buffer.from(`${name}@${version} tarball`);
    await writeFile(path.join(directory, tarball), bytes);
    await writeFile(path.join(directory, `${tarball}.meta`), JSON.stringify([name, version, integrity(bytes)]));
    entries.push({ name, version, tarball, integrity: integrity(bytes) });
  }
  await writeFile(path.join(directory, 'release-manifest.json'), JSON.stringify({ repository: 'mike-north/microdelta', commit: sha, packages: entries }));
  await writeFile(path.join(directory, 'npm'), fakeNpm);
  await chmod(path.join(directory, 'npm'), 0o755);
  await writeFile(path.join(directory, 'registry.json'), '{}');
  return { directory, entries };
}

/** Run the publisher as the workflow does: OIDC endpoint, read-only GitHub token, no npm token. */
async function publish(directory, env = {}) {
  const child = spawn(process.execPath, [path.join(root, 'tooling/publish-release.mjs'), '--manifest', path.join(directory, 'release-manifest.json')], {
    env: {
      GITHUB_API_URL: github.url,
      GITHUB_TOKEN: 'read-only-test-token',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      FAKE_REGISTRY: path.join(directory, 'registry.json'),
      FAKE_NPM_LOG: path.join(directory, 'npm.log'),
      GITHUB_SHA: sha,
      GITHUB_REPOSITORY: 'mike-north/microdelta',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example.test',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'job-local-request-token',
      ...env,
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const status = await new Promise(resolve => child.on('close', resolve));
  return { status, stdout, stderr };
}

/** Every npm command the publisher attempted, in order. */
async function npmCalls(directory) {
  const log = await readFile(path.join(directory, 'npm.log'), 'utf8').catch(() => '');
  return log.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('publishes every absent package in dependency order with public trusted-publishing provenance', async () => {
  const { directory } = await releaseFixture();
  try {
    const result = await publish(directory);
    assert.equal(result.status, 0, result.stderr);
    const publishes = (await npmCalls(directory)).filter(call => call.args[0] === 'publish');
    assert.deepEqual(publishes.map(call => path.basename(call.args[1])), [
      'microdelta-machine-0.1.0.tgz',
      'microdelta-value-0.1.0.tgz',
      'microdelta-0.0.1.tgz',
    ]);
    for (const call of publishes) {
      assert.deepEqual(call.args.slice(2), ['--access', 'public', '--tag', 'latest', '--provenance', '--ignore-scripts']);
      assert.equal(call.token, null);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('every registry check happens before the first publish side effect', async () => {
  const { directory } = await releaseFixture();
  try {
    assert.equal((await publish(directory)).status, 0);
    const calls = await npmCalls(directory);
    const firstPublish = calls.findIndex(call => call.args[0] === 'publish');
    const views = calls.slice(0, firstPublish).filter(call => call.args[0] === 'view');
    assert.equal(views.filter(call => call.args[2] === 'dist.integrity').length, 3);
    assert.equal(views.filter(call => call.args[2] === 'dist-tags.latest').length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a partial publication resumes by skipping identical versions only', async () => {
  const { directory } = await releaseFixture();
  try {
    const failed = await publish(directory, { FAKE_FAIL_PUBLISH: 'microdelta-value' });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /Publishing @microdelta\/value@0\.1\.0 failed/u);
    assert.match(failed.stderr, /Already published: @microdelta\/machine@0\.1\.0/u);
    assert.ok(!(await npmCalls(directory)).some(call => call.args[0] === 'publish' && call.args[1].includes('microdelta-0.0.1')));

    await rm(path.join(directory, 'npm.log'));
    const resumed = await publish(directory);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.match(resumed.stdout, /@microdelta\/machine@0\.1\.0 is already published with identical contents/u);
    const publishes = (await npmCalls(directory)).filter(call => call.args[0] === 'publish');
    assert.deepEqual(publishes.map(call => path.basename(call.args[1])), ['microdelta-value-0.1.0.tgz', 'microdelta-0.0.1.tgz']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a registry version with different contents stops publication before any side effect', async () => {
  const { directory } = await releaseFixture();
  try {
    await writeFile(path.join(directory, 'registry.json'), JSON.stringify({ microdelta: { '0.0.1': 'sha512-different' } }));
    const result = await publish(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /microdelta@0\.0\.1 already exists on npm with different contents/u);
    assert.ok(!(await npmCalls(directory)).some(call => call.args[0] === 'publish'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unexpected registry failures are never treated as absent packages', async () => {
  const { directory } = await releaseFixture();
  try {
    await writeFile(path.join(directory, 'registry.json'), JSON.stringify({ '@microdelta/value': 'error' }));
    const result = await publish(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Could not read @microdelta\/value@0\.1\.0 from npm: E500/u);
    assert.ok(!(await npmCalls(directory)).some(call => call.args[0] === 'publish'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the reserved bootstrap version is refused even if it reaches the publisher', async () => {
  const { directory } = await releaseFixture([['@microdelta/machine', '0.0.0']]);
  try {
    const result = await publish(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /@microdelta\/machine@0\.0\.0 is the reserved npm bootstrap version/u);
    assert.deepEqual(await npmCalls(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an untrusted package name in the artifact is refused', async () => {
  const { directory } = await releaseFixture([['@microdelta/accounting', '0.1.0']]);
  try {
    const result = await publish(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /@microdelta\/accounting is not registered for npm trusted publishing/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a tarball altered after verification is refused', async () => {
  const { directory, entries } = await releaseFixture();
  try {
    await writeFile(path.join(directory, entries[1].tarball), 'tampered');
    const result = await publish(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /@microdelta\/value@0\.1\.0 tarball does not match its verified integrity/u);
    assert.deepEqual(await npmCalls(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('artifacts built from another commit are refused as a stale selection', async () => {
  const { directory } = await releaseFixture();
  try {
    const result = await publish(directory, { GITHUB_SHA: 'e'.repeat(40) });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /artifacts were built from d{40}, not the release commit e{40}/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('tarball paths cannot escape the artifact directory', async () => {
  const { directory } = await releaseFixture();
  try {
    const manifestPath = path.join(directory, 'release-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.packages[0].tarball = '../outside.tgz';
    await writeFile(manifestPath, JSON.stringify(manifest));
    const result = await publish(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tarball must be a file name inside the release artifact/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('long-lived npm tokens are refused so only OIDC can authorize publication', async () => {
  const { directory } = await releaseFixture();
  try {
    for (const variable of ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'npm_config__authToken']) {
      const result = await publish(directory, { [variable]: 'npm_longlived' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`${variable} is set; trusted publishing must not use a long-lived npm token`, 'u'));
    }
    assert.deepEqual(await npmCalls(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('publication requires the job-local OIDC capability', async () => {
  const { directory } = await releaseFixture();
  try {
    const result = await publish(directory, { ACTIONS_ID_TOKEN_REQUEST_URL: '', ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /id-token: write/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('npm older than the trusted-publishing minimum is refused', async () => {
  const { directory } = await releaseFixture();
  try {
    const result = await publish(directory, { FAKE_NPM_VERSION: '11.5.0' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /npm 11\.5\.0 is older than 11\.5\.1/u);
    assert.ok(!(await npmCalls(directory)).some(call => call.args[0] !== '--version'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** The decision CLI exactly as the release-decision job runs it for this commit. */
async function decisionJob() {
  const child = spawn(process.execPath, [path.join(root, 'tooling/release-decision.mjs')], {
    env: {
      PATH: process.env.PATH,
      GITHUB_API_URL: github.url,
      GITHUB_TOKEN: 'read-only-test-token',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: sha,
      GITHUB_REPOSITORY: repository,
    },
  });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  const status = await new Promise(resolve => child.on('close', resolve));
  return { status, stdout };
}

// Issue #64 review finding 2: release A's decision succeeded, then Version
// Packages PR B merged while A packaged, queued, or was re-run via "Re-run
// failed jobs". A's publisher must re-establish eligibility, not reuse A's output.
test('a release made stale after its decision job succeeded publishes nothing', async () => {
  const { directory } = await releaseFixture();
  try {
    const decided = await decisionJob();
    assert.equal(decided.status, 0);
    assert.match(decided.stdout, /Version Packages PR #49 was merged as this main commit/u);

    github.mergedPulls = [versionPull(), newerRelease];
    const result = await publish(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /stale release: Version Packages PR #80 was merged after #49/u);
    assert.ok(!(await npmCalls(directory)).some(call => call.args[0] === 'publish'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a newer release merged during publication stops before the next package', async () => {
  const { directory } = await releaseFixture();
  try {
    // Eligibility is read before the registry plan (1) and before each
    // publish (2, 3, ...); the newer release appears at the third read.
    github.mergedPulls = count => (count >= 3 ? [versionPull(), newerRelease] : [versionPull()]);
    const result = await publish(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /stale release: Version Packages PR #80 was merged after #49/u);
    assert.match(result.stderr, /Already published: @microdelta\/machine@0\.1\.0/u);
    const publishes = (await npmCalls(directory)).filter(call => call.args[0] === 'publish');
    assert.deepEqual(publishes.map(call => path.basename(call.args[1])), ['microdelta-machine-0.1.0.tgz']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a commit that is not a merged Version Packages PR cannot publish', async () => {
  const { directory } = await releaseFixture();
  try {
    github.associated = [];
    const result = await publish(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not eligible for publication: This main commit is not a merged Version Packages PR/u);
    assert.ok(!(await npmCalls(directory)).some(call => call.args[0] === 'publish'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing or unreadable release evidence fails closed without publishing', async () => {
  const { directory } = await releaseFixture();
  try {
    const noToken = await publish(directory, { GITHUB_TOKEN: '' });
    assert.notEqual(noToken.status, 0);
    assert.match(noToken.stderr, /GITHUB_TOKEN is required/u);

    const notPush = await publish(directory, { GITHUB_EVENT_NAME: 'workflow_dispatch' });
    assert.notEqual(notPush.status, 0);
    assert.match(notPush.stderr, /not eligible for publication: workflow_dispatch prepares versions/u);

    github.failStatus = 502;
    const unreadable = await publish(directory);
    assert.notEqual(unreadable.status, 0);
    assert.match(unreadable.stderr, /GitHub API .* returned 502/u);
    assert.ok(!(await npmCalls(directory)).some(call => call.args[0] === 'publish'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a release that would move latest backward is refused before any publish', async () => {
  const { directory } = await releaseFixture();
  try {
    await writeFile(path.join(directory, 'registry.json'), JSON.stringify({ '@microdelta/value': { '0.2.0': 'sha512-newer', $latest: '0.2.0' } }));
    const result = await publish(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /@microdelta\/value@0\.1\.0 would move latest back from 0\.2\.0/u);
    assert.ok(!(await npmCalls(directory)).some(call => call.args[0] === 'publish'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the bootstrap latest tag is superseded and a resumed version keeps latest', async () => {
  const { directory, entries } = await releaseFixture();
  try {
    await writeFile(path.join(directory, 'registry.json'), JSON.stringify({
      microdelta: { '0.0.0': 'sha512-bootstrap', $latest: '0.0.0' },
      '@microdelta/machine': { '0.0.0': 'sha512-bootstrap', '0.1.0': entries[0].integrity, $latest: '0.1.0' },
    }));
    const result = await publish(directory);
    assert.equal(result.status, 0, result.stderr);
    const registry = JSON.parse(await readFile(path.join(directory, 'registry.json'), 'utf8'));
    assert.equal(registry.microdelta.$latest, '0.0.1');
    assert.equal(registry['@microdelta/machine'].$latest, '0.1.0');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an unreadable latest tag is never treated as absent', async () => {
  const { directory } = await releaseFixture();
  try {
    await writeFile(path.join(directory, 'registry.json'), JSON.stringify({ '@microdelta/value': { $latest: 'error' } }));
    const result = await publish(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Could not read the latest tag of @microdelta\/value from npm: E500/u);
    assert.ok(!(await npmCalls(directory)).some(call => call.args[0] === 'publish'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('versions compare by SemVer precedence', () => {
  assert.equal(compareVersions('0.1.0', '0.0.9'), 1);
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('1.0.0-alpha.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0-alpha.10', '1.0.0-alpha.2'), 1);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compareVersions('1.0.0-alpha.beta', '1.0.0-alpha.1'), 1);
  assert.equal(compareVersions('1.0.0+build.2', '1.0.0+build.1'), 0);
  assert.equal(compareVersions('0.0.0-bootstrap.0', '0.0.0'), -1);
});
