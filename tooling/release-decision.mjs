/**
 * Release decision for `release.yml`.
 *
 * The human-controlled decision to release is merging the reviewed Changesets
 * "Version Packages" PR into main. This script recognizes exactly that event:
 * a `push` to main in the trusted repository whose commit is the merge commit
 * of a merged `changeset-release/main` PR from the same repository, and that PR
 * is still the most recently merged version PR. Manual dispatch, PR events,
 * version-branch updates, and ordinary feature pushes prepare versions only.
 * A re-run of an older release after a newer version merge fails closed so a
 * stale selection is never published. It reads GitHub with the job token and
 * never has publication credentials.
 */
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { trustedPublisher } from './release-graph.mjs';

/** The Changesets action's version branch for base `main`. */
export const versionBranch = 'changeset-release/main';

/** A condition in which no release decision can be trusted. */
export class ReleaseDecisionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseDecisionError';
  }
}

/** Whether a PR is a merged version PR from this repository into main. */
function isMergedVersionPull(pull, repository) {
  return typeof pull?.merged_at === 'string' &&
    pull.base?.ref === 'main' &&
    pull.head?.ref === versionBranch &&
    pull.head?.repo?.full_name === repository &&
    (pull.base?.repo?.full_name ?? repository) === repository;
}

/**
 * Decide from GitHub facts whether this run publishes.
 *
 * `associatedPulls` are PRs GitHub associates with the pushed commit;
 * `mergedVersionPulls` are closed PRs from the version branch into main.
 */
export function decideRelease({ eventName, repository, ref, sha, associatedPulls, mergedVersionPulls }) {
  if (repository !== trustedPublisher.repository) {
    throw new ReleaseDecisionError(`only ${trustedPublisher.repository} may publish; this run belongs to ${repository}`);
  }
  if (eventName !== 'push') {
    return { publish: false, pullNumber: null, reason: `${eventName} prepares versions; only a push of the merged Version Packages PR publishes.` };
  }
  if (ref !== 'refs/heads/main') throw new ReleaseDecisionError(`release pushes must target refs/heads/main, not ${ref}`);

  const release = (associatedPulls ?? []).find(pull => isMergedVersionPull(pull, repository) && pull.merge_commit_sha === sha);
  if (release === undefined) {
    return { publish: false, pullNumber: null, reason: 'This main commit is not a merged Version Packages PR; nothing is published.' };
  }

  const merged = (mergedVersionPulls ?? []).filter(pull => isMergedVersionPull(pull, repository));
  const latest = merged.reduce((best, pull) => (best === undefined || pull.merged_at > best.merged_at ? pull : best), undefined);
  if (latest === undefined || !merged.some(pull => pull.number === release.number)) {
    throw new ReleaseDecisionError(`could not confirm #${release.number} as the latest merged Version Packages PR`);
  }
  if (latest.number !== release.number || latest.merge_commit_sha !== sha) {
    throw new ReleaseDecisionError(`stale release: Version Packages PR #${latest.number} was merged after #${release.number}; publish from the newer release run instead`);
  }
  return { publish: true, pullNumber: release.number, reason: `Version Packages PR #${release.number} was merged as this main commit.` };
}

/** Read one GitHub REST resource with the job's read-only token. */
async function github(apiUrl, token, resource) {
  const response = await fetch(`${apiUrl}${resource}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new ReleaseDecisionError(`GitHub API ${resource} returned ${response.status}`);
  return response.json();
}

/**
 * Gather the decision's facts from the standard Actions environment. GitHub is
 * read only for a push in the trusted repository; any missing token or failed
 * read throws rather than producing a decision. The release-decision job and
 * the publisher's final-boundary revalidation both use this reader.
 */
export async function readReleaseFacts(env) {
  for (const variable of ['GITHUB_EVENT_NAME', 'GITHUB_REPOSITORY', 'GITHUB_REF']) {
    if (!env[variable]) throw new ReleaseDecisionError(`${variable} is required to decide a release`);
  }
  const facts = {
    eventName: env.GITHUB_EVENT_NAME,
    repository: env.GITHUB_REPOSITORY,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
    associatedPulls: [],
    mergedVersionPulls: [],
  };
  if (!/^[0-9a-f]{40}$/u.test(facts.sha ?? '')) throw new ReleaseDecisionError('GITHUB_SHA must be a full commit SHA');
  if (facts.eventName === 'push' && facts.repository === trustedPublisher.repository) {
    const apiUrl = env.GITHUB_API_URL ?? 'https://api.github.com';
    if (!env.GITHUB_TOKEN) throw new ReleaseDecisionError('GITHUB_TOKEN is required to read the release decision');
    const [owner] = facts.repository.split('/');
    facts.associatedPulls = await github(apiUrl, env.GITHUB_TOKEN, `/repos/${facts.repository}/commits/${facts.sha}/pulls?per_page=100`);
    const query = new URLSearchParams({ state: 'closed', base: 'main', head: `${owner}:${versionBranch}`, sort: 'updated', direction: 'desc', per_page: '100' });
    facts.mergedVersionPulls = await github(apiUrl, env.GITHUB_TOKEN, `/repos/${facts.repository}/pulls?${query}`);
  }
  return facts;
}

/** Decide from live GitHub state; throws when eligibility cannot be established. */
export async function currentReleaseDecision(env) {
  return decideRelease(await readReleaseFacts(env));
}

/** Write the job outputs consumed by the package and publish jobs. */
async function main() {
  const env = process.env;
  const decision = await currentReleaseDecision(env);
  process.stdout.write(`${decision.reason}\n`);
  if (env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, `publish=${decision.publish}\npull=${decision.pullNumber ?? ''}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    process.stderr.write(`Release decision failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
