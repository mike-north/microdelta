/**
 * Publish verified release tarballs to npm through trusted publishing (OIDC).
 *
 * Runs only in `release.yml`'s publish job, after the release decision and
 * the package job produced `release-manifest.json` plus tarballs for the
 * exact release commit. Before any side effect it confirms: the artifact names
 * the trusted repository and this commit; every package is registered for
 * trusted publishing and is not the reserved bootstrap version; every tarball
 * still matches its verified integrity; no long-lived npm token is present;
 * the job has an OIDC token endpoint; and npm is new enough for trusted
 * publishing. It then reads the registry for every package. A version already
 * published with identical contents is skipped (resuming a partial run); a
 * version published with different contents, or any registry error other
 * than "not found", stops the release before anything is published. Remaining
 * packages are published one at a time in dependency order; the first failure
 * stops the run and names what was already published.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bootstrapVersion, registeredPackages, trustedPublisher } from './release-graph.mjs';

/** npm's documented minimum for trusted publishing. */
export const minimumNpmVersion = '11.5.1';

/** Environment variables that would supply a long-lived npm credential. */
const tokenVariables = ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'npm_config__authToken', 'NPM_CONFIG__AUTHTOKEN'];

/** A condition under which publication must not start or continue. */
class PublishError extends Error {}

/** Numeric comparison of `major.minor.patch` prefixes. */
function versionAtLeast(actual, minimum) {
  const parse = value => value.split(/[.-]/u).slice(0, 3).map(Number);
  const [a, b] = [parse(actual), parse(minimum)];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return true;
}

/** Run npm synchronously; publication is intentionally one package at a time. */
function npm(args) {
  return spawnSync('npm', args, { encoding: 'utf8', env: process.env });
}

/** Refuse anything but the artifact the package job verified for this commit. */
async function readRelease(manifestPath) {
  const directory = path.dirname(manifestPath);
  const release = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (release.repository !== trustedPublisher.repository) {
    throw new PublishError(`release artifact names ${release.repository}, not ${trustedPublisher.repository}`);
  }
  if (process.env.GITHUB_REPOSITORY !== trustedPublisher.repository) {
    throw new PublishError(`only ${trustedPublisher.repository} may publish`);
  }
  if (release.commit !== process.env.GITHUB_SHA) {
    throw new PublishError(`artifacts were built from ${release.commit}, not the release commit ${process.env.GITHUB_SHA}`);
  }
  if (!Array.isArray(release.packages) || release.packages.length === 0) throw new PublishError('release artifact lists no packages');
  const packages = [];
  for (const entry of release.packages) {
    const id = `${entry.name}@${entry.version}`;
    if (!registeredPackages.includes(entry.name)) throw new PublishError(`${entry.name} is not registered for npm trusted publishing`);
    if (entry.version === bootstrapVersion) throw new PublishError(`${id} is the reserved npm bootstrap version`);
    if (typeof entry.tarball !== 'string' || path.basename(entry.tarball) !== entry.tarball || !entry.tarball.endsWith('.tgz')) {
      throw new PublishError(`${id} tarball must be a file name inside the release artifact`);
    }
    const file = path.join(directory, entry.tarball);
    const actual = `sha512-${createHash('sha512').update(await readFile(file)).digest('base64')}`;
    if (actual !== entry.integrity) throw new PublishError(`${id} tarball does not match its verified integrity`);
    packages.push({ ...entry, id, file });
  }
  return packages;
}

/** Only OIDC may authorize publication in this job. */
function requireTrustedEnvironment() {
  for (const variable of tokenVariables) {
    if (process.env[variable]) throw new PublishError(`${variable} is set; trusted publishing must not use a long-lived npm token`);
  }
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new PublishError('no GitHub OIDC token endpoint; the publish job needs job-local permissions id-token: write');
  }
  const version = npm(['--version']);
  if (version.status !== 0) throw new PublishError(`npm --version failed: ${version.stderr.trim()}`);
  const actual = version.stdout.trim();
  if (!versionAtLeast(actual, minimumNpmVersion)) throw new PublishError(`npm ${actual} is older than ${minimumNpmVersion}, the trusted-publishing minimum`);
}

/**
 * Classify one package against the registry: `absent`, `identical`, or a
 * thrown refusal. npm reports an unknown package as E404 and an unknown
 * version of a known package as empty output.
 */
function registryState(entry) {
  const result = npm(['view', `${entry.name}@${entry.version}`, 'dist.integrity', '--json']);
  const output = result.stdout.trim();
  if (result.status !== 0) {
    let code = 'unknown error';
    try {
      code = JSON.parse(output).error?.code ?? code;
    } catch {
      code = result.stderr.trim() || code;
    }
    if (code === 'E404') return 'absent';
    throw new PublishError(`Could not read ${entry.id} from npm: ${code}`);
  }
  if (output === '') return 'absent';
  const published = JSON.parse(output);
  if (published === entry.integrity) return 'identical';
  throw new PublishError(`${entry.id} already exists on npm with different contents (${published}); npm versions are immutable, so select a new version`);
}

/** Record a line in the Actions job summary when available. */
async function summary(line) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

/** Validate everything, then publish absent packages in artifact order. */
async function main() {
  const index = process.argv.indexOf('--manifest');
  if (index === -1 || !process.argv[index + 1]) throw new PublishError('usage: publish-release.mjs --manifest <release-manifest.json>');
  const packages = await readRelease(path.resolve(process.argv[index + 1]));
  requireTrustedEnvironment();

  const plan = packages.map(entry => ({ entry, state: registryState(entry) }));
  const published = [];
  for (const { entry, state } of plan) {
    if (state === 'identical') {
      process.stdout.write(`${entry.id} is already published with identical contents; skipping.\n`);
      published.push(entry.id);
      continue;
    }
    const result = npm(['publish', entry.file, '--access', 'public', '--tag', 'latest', '--provenance', '--ignore-scripts']);
    if (result.status !== 0) {
      throw new PublishError([
        `Publishing ${entry.id} failed: ${result.stderr.trim() || result.stdout.trim()}`,
        `Already published: ${published.length > 0 ? published.join(', ') : 'none'}.`,
        'Re-run this failed job to resume; identical published versions are skipped.',
      ].join('\n'));
    }
    process.stdout.write(`Published ${entry.id}.\n`);
    await summary(`- Published \`${entry.id}\``);
    published.push(entry.id);
  }
  process.stdout.write(`Release complete: ${published.join(', ')}.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof PublishError ? '' : 'Unexpected error: '}${error.message}\n`);
    process.exitCode = 1;
  });
}
