/**
 * Publication consumes only verified release artifacts, checks the registry for
 * every package before its first side effect, and resumes safely after a
 * partial run. A fake `npm` on PATH stands in for the registry: these tests
 * never contact or write to npm.
 *
 * @see https://docs.npmjs.com/trusted-publishers
 * @see https://docs.npmjs.com/cli/v11/commands/npm-publish
 * @see https://docs.npmjs.com/cli/v11/commands/npm-view
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = 'd'.repeat(40);

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
  registry[name] = { ...(registry[name] === undefined ? {} : registry[name]), [version]: value };
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

/** Run the publisher as the workflow does, with a job OIDC endpoint and no token. */
function publish(directory, env = {}) {
  const result = spawnSync(process.execPath, [path.join(root, 'tooling/publish-release.mjs'), '--manifest', path.join(directory, 'release-manifest.json')], {
    encoding: 'utf8',
    env: {
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
  return result;
}

/** Every npm command the publisher attempted, in order. */
async function npmCalls(directory) {
  const log = await readFile(path.join(directory, 'npm.log'), 'utf8').catch(() => '');
  return log.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('publishes every absent package in dependency order with public trusted-publishing provenance', async () => {
  const { directory } = await releaseFixture();
  try {
    const result = publish(directory);
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
    assert.equal(publish(directory).status, 0);
    const calls = (await npmCalls(directory)).map(call => call.args[0]);
    const firstPublish = calls.indexOf('publish');
    assert.equal(calls.slice(0, firstPublish).filter(command => command === 'view').length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a partial publication resumes by skipping identical versions only', async () => {
  const { directory } = await releaseFixture();
  try {
    const failed = publish(directory, { FAKE_FAIL_PUBLISH: 'microdelta-value' });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /Publishing @microdelta\/value@0\.1\.0 failed/u);
    assert.match(failed.stderr, /Already published: @microdelta\/machine@0\.1\.0/u);
    assert.ok(!(await npmCalls(directory)).some(call => call.args[0] === 'publish' && call.args[1].includes('microdelta-0.0.1')));

    await rm(path.join(directory, 'npm.log'));
    const resumed = publish(directory);
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
    const result = publish(directory);
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
    const result = publish(directory);
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
    const result = publish(directory);
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
    const result = publish(directory);
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
    const result = publish(directory);
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
    const result = publish(directory, { GITHUB_SHA: 'e'.repeat(40) });
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
    const result = publish(directory);
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
      const result = publish(directory, { [variable]: 'npm_longlived' });
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
    const result = publish(directory, { ACTIONS_ID_TOKEN_REQUEST_URL: '', ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /id-token: write/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('npm older than the trusted-publishing minimum is refused', async () => {
  const { directory } = await releaseFixture();
  try {
    const result = publish(directory, { FAKE_NPM_VERSION: '11.5.0' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /npm 11\.5\.0 is older than 11\.5\.1/u);
    assert.ok(!(await npmCalls(directory)).some(call => call.args[0] !== '--version'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
