#!/usr/bin/env node
/**
 * Human-operated release review for the Changesets "Version Packages" PR.
 *
 * `main` requires the exact-head **Supervisor review** status on every PR. The
 * ordinary supervisor command (supervisor-review.mjs) refuses release PRs
 * because it arms auto-merge, and merging a Version Packages PR is the release
 * decision: `release.yml` then publishes to npm. This command lets a human
 * maintainer satisfy that required status for one exact release head without
 * taking that decision away from them. It keeps every ordinary gate — the
 * trusted repository, the complete `main` protection rule, an open non-draft
 * PR on `main` at the expected head, resolved conversations, and a genuine
 * completed Copilot review of the pull request — and adds release-specific ones:
 * the PR must be the `changeset-release/main` branch of this repository titled
 * "Version Packages"; every required check must have *completed successfully*
 * on the head (pending or skipped results are not enough for a release);
 * auto-merge must be off; and the operator supplies substantive review scope,
 * evidence, and fresh verification results, then confirms interactively by
 * typing the head prefix. It writes a PR comment and the pending, then
 * success, status on that SHA, re-reading every gate between them. It never
 * arms auto-merge, approves, or merges; the maintainer merges manually.
 * Applying it is a release step and needs the owner's authorization.
 */
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_BRANCH_CHECKS,
  REQUIRED_STATUS_CONTEXT,
  TARGET_REPOSITORY,
  createGitHubApi,
  validateChecks,
  validateCopilotReview,
  validateProtection,
  validateRequest,
} from './supervisor-review.mjs';

/** The Changesets action's version branch for base `main`. */
const RELEASE_BRANCH = 'changeset-release/main';

/** Characters of the head OID the operator must type to confirm. */
const CONFIRMATION_LENGTH = 12;

/** Validate operator-supplied evidence before any GitHub read or write. */
function validateReleaseRequest(request) {
  validateRequest(request);
  if (typeof request.verification !== 'string' || request.verification.trim().length === 0) {
    throw new Error('Fresh verification evidence is required (for example fresh-clone check, test and build results for this head).');
  }
  if (typeof request.confirm !== 'function') {
    throw new Error('Release review requires an interactive human confirmation.');
  }
}

/** The PR must be this repository's open Version Packages PR at the reviewed head, not armed to merge. */
function validateReleasePullRequest(pullRequest, request, defaultBranch) {
  if (pullRequest.number !== request.pullRequestNumber) throw new Error('GitHub returned a different pull request.');
  if (!/^Version Packages/iu.test(pullRequest.title ?? '')) {
    throw new Error('Release review is only for the Changesets Version Packages PR; use supervisor-review.mjs for other PRs.');
  }
  if (pullRequest.headRefName !== RELEASE_BRANCH || pullRequest.headRepositoryNameWithOwner !== TARGET_REPOSITORY) {
    throw new Error(`A release PR must use head branch ${RELEASE_BRANCH} in ${TARGET_REPOSITORY}.`);
  }
  if (pullRequest.state !== 'OPEN' || pullRequest.merged) throw new Error('Release pull request must be open and unmerged.');
  if (pullRequest.isDraft) throw new Error('Draft pull requests cannot receive release review status.');
  if (pullRequest.baseRefName !== defaultBranch) throw new Error(`Release pull request must target ${defaultBranch}.`);
  if (pullRequest.headRefOid !== request.expectedHeadOid) throw new Error('Release pull request head changed; review the current head again.');
  if (pullRequest.unresolvedThreads !== 0) throw new Error('Resolve all review conversations before recording release review.');
  if (pullRequest.autoMergeEnabled) {
    throw new Error('Auto-merge is enabled; a release PR must be merged manually. Disable auto-merge and inspect the PR first.');
  }
}

/** A release needs every required check finished and passing, not merely non-failing. */
function validateCompletedChecks(checks) {
  const summary = validateChecks(checks);
  const incomplete = summary.filter(check => check.bucket !== 'pass').map(check => check.name);
  if (incomplete.length > 0) {
    throw new Error(`Required checks must have completed successfully on the exact head: ${incomplete.join(', ')}.`);
  }
}

/** Re-read every gate against live GitHub state. */
async function verifyReleaseState(request, api) {
  const repository = await api.readRepository();
  if (repository.nameWithOwner !== TARGET_REPOSITORY) throw new Error(`This command only supports ${TARGET_REPOSITORY}.`);
  if (repository.defaultBranch !== 'main') throw new Error('The expected protected default branch is main.');
  validateProtection(await api.readProtection(repository.defaultBranch), repository.defaultBranch);
  const pullRequest = await api.readPullRequest(request.pullRequestNumber);
  validateReleasePullRequest(pullRequest, request, repository.defaultBranch);
  validateCompletedChecks(await api.readRequiredChecks(request.pullRequestNumber, request.expectedHeadOid));
  validateCopilotReview(await api.readCopilotReviews(request.pullRequestNumber), request.expectedHeadOid);
  return pullRequest;
}

/**
 * Execute the release review against an injected GitHub boundary. The API's
 * `enableAutoMerge` is deliberately never called.
 */
export async function runReleaseReview(request, api) {
  validateReleaseRequest(request);
  const pullRequest = await verifyReleaseState(request, api);

  const typed = await request.confirm([
    `Release review for Version Packages PR #${request.pullRequestNumber} (${pullRequest.url}).`,
    `Head: ${request.expectedHeadOid}`,
    `This records the required ${REQUIRED_STATUS_CONTEXT} status on that exact head only.`,
    'It does not merge. Merging the PR manually afterwards is the release decision and publishes to npm.',
    `Type the first ${CONFIRMATION_LENGTH} characters of the head to continue: `,
  ].join('\n'));
  if (String(typed ?? '').trim() !== request.expectedHeadOid.slice(0, CONFIRMATION_LENGTH)) {
    throw new Error('Confirmation did not match the reviewed head; nothing was recorded.');
  }

  const scope = request.scope.trim();
  const evidence = request.evidence.trim();
  const verification = request.verification.trim();
  const reviewComment = await api.createReviewRecord({
    pullRequestNumber: request.pullRequestNumber,
    expectedHeadOid: request.expectedHeadOid,
    scope,
    evidence,
    body: [
      `Release review for \`${request.expectedHeadOid}\`.`,
      '',
      `Scope: ${scope}`,
      '',
      `Evidence: ${evidence}`,
      '',
      `Fresh verification: ${verification}`,
      '',
      `Required checks (${REQUIRED_BRANCH_CHECKS.join(', ')}) completed successfully and a completed Copilot review of this pull request was found.`,
      'This status does not merge or arm auto-merge. A maintainer\'s manual merge of this PR is the release decision; release.yml then publishes to npm.',
      'A new commit requires a fresh release review.',
    ].join('\n'),
  });

  // Pending first: an interrupted run leaves the required status unsatisfied.
  await api.setCommitStatus({
    sha: request.expectedHeadOid,
    context: REQUIRED_STATUS_CONTEXT,
    state: 'pending',
    description: 'Release review in progress for this exact head.',
    targetUrl: reviewComment,
  });

  const current = await verifyReleaseState(request, api);
  if (current.headRefOid !== request.expectedHeadOid) throw new Error('Release pull request head changed during release review.');

  const success = await api.setCommitStatus({
    sha: request.expectedHeadOid,
    context: REQUIRED_STATUS_CONTEXT,
    state: 'success',
    description: `Release review of ${request.expectedHeadOid.slice(0, 12)}; merge manually to release.`,
    targetUrl: reviewComment,
  });
  if (success.sha !== request.expectedHeadOid || success.context !== REQUIRED_STATUS_CONTEXT || success.state !== 'success') {
    throw new Error('GitHub did not confirm the exact-head release review status.');
  }
  const readback = await api.readCommitStatus(request.expectedHeadOid, REQUIRED_STATUS_CONTEXT);
  if (readback.sha !== request.expectedHeadOid || readback.context !== REQUIRED_STATUS_CONTEXT || readback.state !== 'success') {
    throw new Error('Release review status readback did not confirm success on the reviewed head.');
  }

  const outcome = await api.readOutcome(request.pullRequestNumber);
  if (outcome.headRefOid !== request.expectedHeadOid) throw new Error('Release pull request head changed after release review status publication.');
  if (outcome.autoMergeEnabled) {
    throw new Error('Auto-merge was enabled on the release PR; disable it and merge manually after inspecting the PR.');
  }
  return {
    expectedHeadOid: request.expectedHeadOid,
    reviewComment,
    outcome: outcome.merged ? 'merged' : 'awaiting-manual-merge',
  };
}

/** Parse the fixed option set; every option is required exactly once. */
function parseArguments(args) {
  const names = ['--pr', '--head', '--scope', '--evidence', '--verification'];
  const usage = 'Usage: node tooling/release-review.mjs --pr N --head SHA --scope TEXT --evidence TEXT --verification TEXT (--pr, --head, --scope, --evidence, and --verification are required)';
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!names.includes(name) || index + 1 >= args.length || values.has(name)) throw new Error(usage);
    values.set(name, args[index + 1]);
  }
  if (values.size !== names.length) throw new Error(usage);
  const pullRequestNumber = Number(values.get('--pr'));
  if (!Number.isSafeInteger(pullRequestNumber) || String(pullRequestNumber) !== values.get('--pr')) {
    throw new Error('--pr must be a positive base-10 integer.');
  }
  return {
    pullRequestNumber,
    expectedHeadOid: values.get('--head'),
    scope: values.get('--scope'),
    evidence: values.get('--evidence'),
    verification: values.get('--verification'),
  };
}

/** Ask the terminal operator to type the head prefix. */
async function terminalConfirmation(summary) {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await terminal.question(summary);
  } finally {
    terminal.close();
  }
}

/** Refuse non-interactive use before any GitHub call. */
async function main(args) {
  const request = parseArguments(args);
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error('Release review requires an interactive terminal operated by a human maintainer.');
  }
  const result = await runReleaseReview({ ...request, confirm: terminalConfirmation }, createGitHubApi(TARGET_REPOSITORY));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Release review stopped: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
