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
 * publishing.
 *
 * The release-decision job's output is not trusted at this boundary: a run can
 * wait for packaging or the publish lock, or be re-run with "Re-run failed
 * jobs", while a newer Version Packages PR merges. The publisher therefore
 * re-reads GitHub (read-only job token) and requires this commit to still be
 * the latest merged Version Packages PR, both before the registry plan and
 * before every individual publish. Missing or unreadable evidence refuses.
 *
 * It then reads the registry for every package. A version already published
 * with identical contents is skipped (resuming a partial run); a version
 * published with different contents, a version below the package's current
 * `latest` tag (which `--tag latest` would move backward), or any registry
 * error other than "not found" stops the release before anything is
 * published. Remaining packages are published one at a time in dependency
 * order; the first failure stops the run and names what was already published.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { currentReleaseDecision } from './release-decision.mjs';
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

/** SemVer 2.0.0 prerelease identifier precedence (spec item 11.4). */
function compareIdentifiers(a, b) {
  const numeric = /^\d+$/u;
  if (numeric.test(a) && numeric.test(b)) return Math.sign(Number(a) - Number(b));
  if (numeric.test(a)) return -1;
  if (numeric.test(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compare two SemVer versions by precedence: -1, 0 or 1. Build metadata is
 * ignored and a prerelease sorts below its release, per SemVer item 11.
 */
export function compareVersions(left, right) {
  const parse = value => {
    const [core, prerelease] = value.split('+')[0].split(/-(.*)/su);
    return { core: core.split('.').map(Number), prerelease: prerelease === undefined ? [] : prerelease.split('.') };
  };
  const [a, b] = [parse(left), parse(right)];
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return Math.sign(a.core[index] - b.core[index]);
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return Math.sign(b.prerelease.length - a.prerelease.length);
  for (let index = 0; index < Math.min(a.prerelease.length, b.prerelease.length); index += 1) {
    const order = compareIdentifiers(a.prerelease[index], b.prerelease[index]);
    if (order !== 0) return order;
  }
  return Math.sign(a.prerelease.length - b.prerelease.length);
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
 * Read one registry field as JSON. Returns `undefined` when npm reports the
 * package (E404) or the field/version as absent; throws for any other error.
 */
function registryRead(args, label) {
  const result = npm(['view', ...args, '--json']);
  const output = result.stdout.trim();
  if (result.status !== 0) {
    let code = 'unknown error';
    try {
      code = JSON.parse(output).error?.code ?? code;
    } catch {
      code = result.stderr.trim() || code;
    }
    if (code === 'E404') return undefined;
    throw new PublishError(`Could not read ${label} from npm: ${code}`);
  }
  return output === '' ? undefined : JSON.parse(output);
}

/**
 * Refuse a version that `--tag latest` would publish below the package's
 * current `latest`, which would roll consumers back to older code.
 */
function requireLatestOrder(entry) {
  const latest = registryRead([entry.name, 'dist-tags.latest'], `the latest tag of ${entry.name}`);
  if (typeof latest === 'string' && compareVersions(entry.version, latest) < 0) {
    throw new PublishError(`${entry.id} would move latest back from ${latest}; a newer release already exists`);
  }
}

/**
 * Classify one package against the registry: `absent`, `identical`, or a
 * thrown refusal. npm reports an unknown package as E404 and an unknown
 * version of a known package as empty output.
 */
function registryState(entry) {
  const published = registryRead([`${entry.name}@${entry.version}`, 'dist.integrity'], entry.id);
  if (published === undefined) return 'absent';
  if (published === entry.integrity) return 'identical';
  throw new PublishError(`${entry.id} already exists on npm with different contents (${published}); npm versions are immutable, so select a new version`);
}

/** Record a line in the Actions job summary when available. */
async function summary(line) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

/**
 * Re-establish from live GitHub state that this run's commit is still the
 * latest release decision. `published` names what this run already published,
 * so a refusal part way through is reported precisely.
 */
async function requireStillEligible(published) {
  let decision;
  try {
    decision = await currentReleaseDecision(process.env);
    if (!decision.publish) throw new PublishError(`this run is not eligible for publication: ${decision.reason}`);
  } catch (error) {
    throw new PublishError([
      `Release eligibility refused: ${error.message}`,
      `Already published: ${published.length > 0 ? published.join(', ') : 'none'}.`,
    ].join('\n'));
  }
  return decision;
}

/** Validate everything, then publish absent packages in artifact order. */
async function main() {
  const index = process.argv.indexOf('--manifest');
  if (index === -1 || !process.argv[index + 1]) throw new PublishError('usage: publish-release.mjs --manifest <release-manifest.json>');
  const packages = await readRelease(path.resolve(process.argv[index + 1]));
  requireTrustedEnvironment();
  const decision = await requireStillEligible([]);
  process.stdout.write(`${decision.reason}\n`);

  const plan = packages.map(entry => {
    const state = registryState(entry);
    requireLatestOrder(entry);
    return { entry, state };
  });
  const published = [];
  for (const { entry, state } of plan) {
    if (state === 'identical') {
      process.stdout.write(`${entry.id} is already published with identical contents; skipping.\n`);
      published.push(entry.id);
      continue;
    }
    await requireStillEligible(published);
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

