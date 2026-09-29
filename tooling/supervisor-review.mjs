#!/usr/bin/env node
/**
 * This repository-scoped command binds a supervisor's review decision to one
 * exact PR head before asking GitHub to merge only after its required gates pass.
 * It records judgment supplied by the operator; CI output cannot manufacture it.
 * Changesets Version Packages PRs are refused here: they use the separate,
 * human-operated release-review.mjs, which shares these gates but never arms
 * auto-merge, so a maintainer's manual merge stays the only release decision.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** The only repository whose protection contract this command knows. */
export const TARGET_REPOSITORY = 'mike-north/microdelta';

/** These protected checks remain independent merge gates beside supervisor review. */
export const REQUIRED_BRANCH_CHECKS = Object.freeze([
  'PR metadata',
  'core (20)',
  'core (22)',
  'core (24)',
]);

/** This required status is the exact-head review decision that resets on each commit. */
export const REQUIRED_STATUS_CONTEXT = 'Supervisor review';

/** GitHub Actions owns the existing CI contexts; the supervisor status remains separate. */
const REQUIRED_CHECK_SOURCE = 'github-actions';

/** GitHub uses this application ID for the source-pinned Actions check producer. */
const GITHUB_ACTIONS_APP_ID = 15368;

/** GitHub's two API login forms identify Copilot's review agent, not a display label. */
const COPILOT_REVIEWER_LOGINS = new Set([
  'copilot-pull-request-reviewer[bot]',
  'copilot-pull-request-reviewer',
]);

/** GitHub treats pass, pending, and skipped checks as non-failing at this preflight. */
const ACCEPTED_CHECK_BUCKETS = new Set(['pass', 'pending', 'skipping']);

/** Validate human-supplied review evidence before any network call or status write. */
export function validateRequest(request) {
  if (!Number.isSafeInteger(request.pullRequestNumber) || request.pullRequestNumber < 1) {
    throw new Error('Pull request number must be a positive integer.');
  }
  if (!/^[0-9a-f]{40}$/iu.test(request.expectedHeadOid)) {
    throw new Error('Expected head must be a full 40-character commit OID.');
  }
  if (typeof request.scope !== 'string' || request.scope.trim().length === 0) {
    throw new Error('Review scope is required.');
  }
  if (typeof request.evidence !== 'string' || request.evidence.trim().length === 0) {
    throw new Error('Review evidence is required.');
  }
}

/** Fail closed unless the current main-branch rule contains the complete review and CI gate. */
export function validateProtection(protection, defaultBranch) {
  if (protection.branch !== defaultBranch) throw new Error('Protection readback did not match the repository default branch.');
  if (!protection.requiresPullRequest) throw new Error('Main branch protection does not require pull requests.');
  if (!protection.strict) throw new Error('Main branch protection does not require an up-to-date base.');
  if (!protection.enforceAdmins) throw new Error('Main branch protection does not apply to administrators.');
  if (!protection.resolveConversations) throw new Error('Main branch protection does not require resolved conversations.');

  const contexts = new Set(protection.requiredContexts);
  const expected = [...REQUIRED_BRANCH_CHECKS, REQUIRED_STATUS_CONTEXT];
  const missing = expected.filter(context => !contexts.has(context));
  if (missing.length > 0) throw new Error(`Main branch protection is missing required checks: ${missing.join(', ')}.`);

  const unscoped = REQUIRED_BRANCH_CHECKS.filter(context => protection.checkSources?.[context] !== REQUIRED_CHECK_SOURCE);
  if (unscoped.length > 0) {
    throw new Error(`GitHub Actions source restriction is missing for: ${unscoped.join(', ')}.`);
  }
}

/** Ensure the PR is still reviewable and has not already entered another merge flow. */
function validatePullRequest(pullRequest, request, defaultBranch) {
  if (pullRequest.number !== request.pullRequestNumber) throw new Error('GitHub returned a different pull request.');
  if (pullRequest.state !== 'OPEN' || pullRequest.merged) throw new Error('Pull request must be open and unmerged.');
  if (pullRequest.isDraft) throw new Error('Draft pull requests cannot receive supervisor review status.');
  if (pullRequest.baseRefName !== defaultBranch) throw new Error(`Pull request must target ${defaultBranch}.`);
  if (pullRequest.headRefOid !== request.expectedHeadOid) throw new Error('Pull request head changed; review the current head again.');
  if (pullRequest.unresolvedThreads !== 0) throw new Error('Resolve all review conversations before recording supervisor review.');
  if (pullRequest.autoMergeEnabled) throw new Error('Auto-merge is already enabled; inspect and reconcile the existing review state first.');
  const reservedReleaseTitle = /^Version Packages/iu.test(pullRequest.title ?? '');
  const reservedReleaseBranch = /^changeset-release\//iu.test(pullRequest.headRefName ?? '');
  if (pullRequest.isReleaseVersion || reservedReleaseTitle || reservedReleaseBranch) {
    throw new Error('Release-version pull requests remain under human-controlled release procedure.');
  }
}

/** Require every protected CI context to be visible and neither failed nor cancelled. */
export function validateChecks(checks) {
  const bucketsByName = new Map();
  for (const check of checks) {
    const buckets = bucketsByName.get(check.name) ?? [];
    buckets.push(check.bucket);
    bucketsByName.set(check.name, buckets);
  }
  const missing = REQUIRED_BRANCH_CHECKS.filter(name => !bucketsByName.has(name));
  if (missing.length > 0) throw new Error(`Required CI results are missing: ${missing.join(', ')}.`);
  const unacceptable = REQUIRED_BRANCH_CHECKS.filter(name =>
    bucketsByName.get(name).some(bucket => !ACCEPTED_CHECK_BUCKETS.has(bucket)),
  );
  if (unacceptable.length > 0) throw new Error(`Required CI checks have non-passing results: ${unacceptable.join(', ')}.`);
  return REQUIRED_BRANCH_CHECKS.map(name => ({
    name,
    bucket: bucketsByName.get(name).includes('pending')
      ? 'pending'
      : bucketsByName.get(name).includes('skipping') ? 'skipping' : 'pass',
  }));
}

/**
 * The body GitHub posts when a Copilot review run fails (for example on a rate limit). Such a
 * review is submitted as COMMENTED but carries no review, so it is never completion evidence.
 */
const COPILOT_ERROR_BODY = /^Copilot encountered an error and was unable to review/u;

/**
 * Require one completed Copilot review of this pull request and reject outstanding requests.
 *
 * The owner's policy is one automatically requested Copilot review per pull request: later
 * pushes are deliberately not re-reviewed, so a completed review of an earlier head counts.
 * The supervisor's own exact-head review (the status this command publishes) is what binds a
 * decision to the current commit. Errored Copilot runs never count, a still-outstanding request
 * blocks, and the most recent real Copilot review must not be pending, dismissed, or a request
 * for changes.
 */
export function validateCopilotReview(reviewState, expectedHeadOid) {
  if (!Array.isArray(reviewState.reviews) || !Array.isArray(reviewState.pendingRequests)) {
    throw new Error('GitHub Copilot review evidence could not be read completely.');
  }
  if (typeof expectedHeadOid !== 'string' || expectedHeadOid.length === 0) {
    throw new Error('The expected head is required to review a pull request.');
  }
  const copilotRequestIsPending = reviewState.pendingRequestsUnread
    || reviewState.pendingRequests.some(login => COPILOT_REVIEWER_LOGINS.has(login));
  if (copilotRequestIsPending) throw new Error('Copilot review is still requested and has not completed.');

  const copilotReviews = reviewState.reviews
    .filter(review =>
      review.authorType === 'Bot'
        && COPILOT_REVIEWER_LOGINS.has(review.authorLogin)
        && review.errored !== true)
    .map((review, order) => ({ review, order }))
    .sort((left, right) =>
      String(left.review.submittedAt ?? '').localeCompare(String(right.review.submittedAt ?? '')) || left.order - right.order)
    .map(({ review }) => review);
  const latest = copilotReviews.at(-1);
  if (latest !== undefined && ['CHANGES_REQUESTED', 'DISMISSED', 'PENDING'].includes(latest.state)) {
    throw new Error('The most recent Copilot review is pending, dismissed, or requests changes.');
  }
  const completedReview = copilotReviews.some(review =>
    review.submitted && ['COMMENTED', 'APPROVED'].includes(review.state),
  );
  if (!completedReview) throw new Error('A completed Copilot COMMENTED or APPROVED review of this pull request is required.');
}

/** Compare repo, protection, PR, and checks before every state-changing step. */
async function verifyCurrentState(request, api) {
  const repository = await api.readRepository();
  if (repository.nameWithOwner !== TARGET_REPOSITORY) throw new Error(`This command only supports ${TARGET_REPOSITORY}.`);
  if (repository.defaultBranch !== 'main') throw new Error('The expected protected default branch is main.');

  const protection = await api.readProtection(repository.defaultBranch);
  validateProtection(protection, repository.defaultBranch);

  const pullRequest = await api.readPullRequest(request.pullRequestNumber);
  validatePullRequest(pullRequest, request, repository.defaultBranch);

  const checks = validateChecks(await api.readRequiredChecks(request.pullRequestNumber, request.expectedHeadOid));
  const copilotReview = await api.readCopilotReviews(request.pullRequestNumber);
  validateCopilotReview(copilotReview, request.expectedHeadOid);
  return { pullRequest, checks };
}

/** Execute the single-head review state machine against an injected GitHub boundary. */
export async function runSupervisorReview(request, api) {
  validateRequest(request);
  const preflight = await verifyCurrentState(request, api);

  const reviewComment = await api.createReviewRecord({
    pullRequestNumber: request.pullRequestNumber,
    expectedHeadOid: request.expectedHeadOid,
    scope: request.scope.trim(),
    evidence: request.evidence.trim(),
    body: [
      `Supervisor review for \`${request.expectedHeadOid}\`.`,
      '',
      `Scope: ${request.scope.trim()}`,
      '',
      `Evidence: ${request.evidence.trim()}`,
      '',
      'This review status is tied to the commit above. A new commit requires fresh substantive review.',
    ].join('\n'),
  });

  // Pending first makes an interrupted run fail safe: required CI cannot merge it yet.
  await api.setCommitStatus({
    sha: request.expectedHeadOid,
    context: REQUIRED_STATUS_CONTEXT,
    state: 'pending',
    description: 'Supervisor is reviewing this exact pull request head.',
    targetUrl: reviewComment,
  });

  // Re-read every material gate so a push, changed rule, or new discussion blocks arming.
  const current = await verifyCurrentState(request, api);
  if (current.pullRequest.headRefOid !== preflight.pullRequest.headRefOid) {
    throw new Error('Pull request head changed during supervisor review.');
  }

  await api.enableAutoMerge({
    pullRequestNumber: request.pullRequestNumber,
    expectedHeadOid: request.expectedHeadOid,
  });

  const outcomeBeforeApproval = await api.readOutcome(request.pullRequestNumber);
  if (outcomeBeforeApproval.headRefOid !== request.expectedHeadOid) {
    throw new Error('Pull request head changed at the auto-merge boundary.');
  }
  if (!outcomeBeforeApproval.autoMergeEnabled && !outcomeBeforeApproval.merged) {
    throw new Error('GitHub did not confirm the auto-merge request.');
  }

  const success = await api.setCommitStatus({
    sha: request.expectedHeadOid,
    context: REQUIRED_STATUS_CONTEXT,
    state: 'success',
    description: `Supervisor reviewed ${request.expectedHeadOid.slice(0, 12)}; see PR for scope and evidence.`,
    targetUrl: reviewComment,
  });
  if (success.sha !== request.expectedHeadOid || success.context !== REQUIRED_STATUS_CONTEXT || success.state !== 'success') {
    throw new Error('GitHub did not confirm the exact-head supervisor status.');
  }

  const statusReadback = await api.readCommitStatus(request.expectedHeadOid, REQUIRED_STATUS_CONTEXT);
  if (statusReadback.sha !== request.expectedHeadOid || statusReadback.context !== REQUIRED_STATUS_CONTEXT || statusReadback.state !== 'success') {
    throw new Error('Supervisor status readback did not confirm success on the reviewed head.');
  }

  const outcome = await api.readOutcome(request.pullRequestNumber);
  if (outcome.headRefOid !== request.expectedHeadOid) throw new Error('Pull request head changed after supervisor status publication.');
  if (!outcome.autoMergeEnabled && !outcome.merged) throw new Error('Auto-merge request is absent after supervisor status publication.');
  const hasPendingChecks = REQUIRED_BRANCH_CHECKS.some(name => current.checks.find(check => check.name === name)?.bucket === 'pending');
  return {
    expectedHeadOid: request.expectedHeadOid,
    reviewComment,
    outcome: outcome.merged ? 'merged' : hasPendingChecks ? 'awaiting-required-checks' : 'ready',
  };
}

/** Run gh without a shell so PR text and user-supplied values stay argument data. */
function gh(args, acceptedExitCodes = [0]) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.error) throw new Error(`Could not run GitHub CLI: ${result.error.message}`);
  if (!acceptedExitCodes.includes(result.status)) {
    throw new Error(`GitHub CLI failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout.trim();
}

/** Decode one JSON response emitted by the authenticated GitHub CLI. */
function ghJson(args, acceptedExitCodes = [0]) {
  const response = gh(args, acceptedExitCodes);
  try {
    return JSON.parse(response);
  } catch (error) {
    throw new Error(`GitHub CLI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Map a GitHub app ID onto the source label validateProtection compares. */
function checkSourceForApp(appId) {
  if (appId === GITHUB_ACTIONS_APP_ID) return REQUIRED_CHECK_SOURCE;
  return appId == null ? null : `app:${appId}`;
}

/**
 * A page of this size may hide further rules, so the reader refuses to reason from it:
 * a rule it never saw could be the one that matters.
 */
const RULES_PAGE_SIZE = 100;

/** The absent-source shape: no requirement is enforced by a source that does not exist. */
const NO_PROTECTION = Object.freeze({
  requiresPullRequest: false,
  strict: false,
  enforceAdmins: false,
  resolveConversations: false,
  requiredContexts: Object.freeze([]),
  checkSources: Object.freeze({}),
});

/** Prefer the source-pinned Actions producer when two enforcement sources describe one context. */
function mergeCheckSources(...sourceMaps) {
  const merged = {};
  for (const sources of sourceMaps) {
    for (const [context, source] of Object.entries(sources)) {
      if (!(context in merged) || (merged[context] !== REQUIRED_CHECK_SOURCE && source === REQUIRED_CHECK_SOURCE)) {
        merged[context] = source;
      }
    }
  }
  return merged;
}

/** Combine sources by union of enforced requirements; the branch name comes from the caller. */
function mergeProtections(branch, ...sources) {
  return {
    branch,
    requiresPullRequest: sources.some(source => source.requiresPullRequest),
    strict: sources.some(source => source.strict),
    enforceAdmins: sources.some(source => source.enforceAdmins),
    resolveConversations: sources.some(source => source.resolveConversations),
    requiredContexts: [...new Set(sources.flatMap(source => source.requiredContexts))],
    checkSources: mergeCheckSources(...sources.map(source => source.checkSources)),
  };
}

/** Normalize the legacy branch-protection payload. */
function normalizeLegacyProtection(rule) {
  const checks = rule.required_status_checks;
  const contexts = checks?.contexts ?? [];
  const checksWithSources = checks?.checks ?? [];
  const requiredContexts = new Set([...contexts, ...checksWithSources.map(check => check.context)]);
  const checkSources = Object.fromEntries(checksWithSources.map(check => [
    check.context,
    checkSourceForApp(check.app_id),
  ]));
  return {
    requiresPullRequest: rule.required_pull_request_reviews != null,
    strict: checks?.strict === true,
    enforceAdmins: rule.enforce_admins?.enabled === true,
    resolveConversations: rule.required_conversation_resolution?.enabled === true,
    requiredContexts: [...requiredContexts],
    checkSources,
  };
}

/**
 * Normalize the rules GitHub reports as active for a branch, plus the owning rulesets' own
 * enforcement and bypass lists. Rules of a ruleset that is not `active` enforce nothing and are
 * ignored. Administrators are covered only when at least one ruleset contributes and every
 * contributing ruleset is active with no bypass actor of any kind.
 */
function normalizeRulesetProtection(rules, rulesetsById) {
  const protection = {
    requiresPullRequest: false,
    strict: false,
    resolveConversations: false,
    requiredContexts: [],
    checkSources: {},
  };
  for (const rule of rules) {
    if (rulesetsById.get(rule.ruleset_id).enforcement !== 'active') continue;
    if (rule.type === 'pull_request') {
      protection.requiresPullRequest = true;
      if (rule.parameters?.required_review_thread_resolution === true) protection.resolveConversations = true;
    } else if (rule.type === 'required_status_checks') {
      if (rule.parameters?.strict_required_status_checks_policy === true) protection.strict = true;
      for (const check of rule.parameters?.required_status_checks ?? []) {
        protection.requiredContexts.push(check.context);
        protection.checkSources = mergeCheckSources(protection.checkSources, { [check.context]: checkSourceForApp(check.integration_id) });
      }
    }
  }
  const contributing = [...rulesetsById.values()];
  const enforceAdmins = contributing.length > 0
    && contributing.every(ruleset => ruleset.enforcement === 'active' && (ruleset.bypass_actors ?? []).length === 0);
  return { ...protection, enforceAdmins };
}

/**
 * Keep GitHub command execution behind one injectable boundary so adapter tests cannot
 * accidentally reach the ambient account and production operations share one CLI path.
 */
export function createGitHubApi(repositoryName, runJson = ghJson) {
  const [owner, name] = repositoryName.split('/');
  const restPrefix = `repos/${owner}/${name}`;
  /** Execute one GraphQL operation and reject partial responses before making gate decisions. */
  const graph = (query, variables) => {
    const result = runJson([
      'api', 'graphql', '-f', `query=${query}`,
      ...Object.entries(variables).flatMap(([key, value]) => ['-F', `${key}=${value}`]),
    ]);
    if (result.errors?.length) throw new Error(`GitHub GraphQL error: ${result.errors.map(error => error.message).join('; ')}`);
    return result;
  };

  /** Legacy protection is optional: a 404 means the branch has none, any other failure is fatal. */
  const readLegacyProtection = branch => {
    try {
      return normalizeLegacyProtection(runJson(['api', `${restPrefix}/branches/${branch}/protection`]));
    } catch (error) {
      if (error instanceof Error && /HTTP 404/u.test(error.message)) return NO_PROTECTION;
      throw error;
    }
  };
  /** Read-only GETs: active rules for the branch, then each contributing ruleset's enforcement and bypass list. */
  const readRulesetProtection = branch => {
    const rules = runJson(['api', `${restPrefix}/rules/branches/${branch}?per_page=${RULES_PAGE_SIZE}`]);
    if (!Array.isArray(rules)) throw new Error('GitHub returned malformed branch rules.');
    if (rules.length >= RULES_PAGE_SIZE) throw new Error('Branch rules response may be truncated; refusing to reason from a partial rule set.');
    const rulesetsById = new Map();
    for (const rule of rules) {
      if (!Number.isSafeInteger(rule.ruleset_id)) throw new Error('GitHub returned a branch rule without its owning ruleset.');
      if (!rulesetsById.has(rule.ruleset_id)) {
        rulesetsById.set(rule.ruleset_id, runJson(['api', `${restPrefix}/rulesets/${rule.ruleset_id}`]));
      }
    }
    return normalizeRulesetProtection(rules, rulesetsById);
  };

  return {
    /** Read canonical repository identity and default branch for all subsequent gate checks. */
    async readRepository() {
      const result = runJson(['api', restPrefix]);
      return { nameWithOwner: result.full_name, defaultBranch: result.default_branch };
    },
    /**
     * Read every source that can protect the branch and normalize them into one requirement set.
     * A requirement holds when either legacy branch protection or an active ruleset enforces it;
     * a requirement absent from both stays false so validateProtection still fails closed.
     */
    async readProtection(branch) {
      const legacy = readLegacyProtection(branch);
      const rulesets = readRulesetProtection(branch);
      return mergeProtections(branch, legacy, rulesets);
    },
    /** Read PR lifecycle state and all review threads so pagination cannot hide unresolved discussion. */
    async readPullRequest(number) {
      const query = `query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){id number title state isDraft baseRefName headRefName headRepository{nameWithOwner} headRefOid url mergedAt autoMergeRequest{enabledAt} reviewThreads(first:100,after:$after){nodes{isResolved} pageInfo{hasNextPage endCursor}}}}}`;
      let after = null;
      let pullRequest;
      let unresolvedThreads = 0;
      do {
        const data = graph(query, { owner, name, number, after });
        const page = data.data?.repository?.pullRequest;
        if (!page) throw new Error(`Pull request #${number} was not found in ${repositoryName}.`);
        pullRequest = page;
        unresolvedThreads += page.reviewThreads.nodes.filter(thread => !thread.isResolved).length;
        const pageInfo = page.reviewThreads.pageInfo;
        if (pageInfo.hasNextPage && !pageInfo.endCursor) throw new Error('GitHub omitted the review-thread pagination cursor.');
        after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
      } while (after !== null);
      return {
        number: pullRequest.number,
        state: pullRequest.state,
        isDraft: pullRequest.isDraft,
        title: pullRequest.title,
        baseRefName: pullRequest.baseRefName,
        headRefName: pullRequest.headRefName,
        headRepositoryNameWithOwner: pullRequest.headRepository?.nameWithOwner ?? null,
        headRefOid: pullRequest.headRefOid,
        url: pullRequest.url,
        nodeId: pullRequest.id,
        unresolvedThreads,
        autoMergeEnabled: pullRequest.autoMergeRequest !== null,
        merged: pullRequest.mergedAt !== null,
        isReleaseVersion: /^Version Packages/iu.test(pullRequest.title) || /^changeset-release\//iu.test(pullRequest.headRefName),
      };
    },
    /** Read current required CI buckets while preserving gh's pending exit code as data. */
    async readRequiredChecks(number) {
      // gh pr checks uses exit code 8 for pending checks while still returning JSON.
      const rows = runJson(['pr', 'checks', String(number), '--repo', repositoryName, '--required', '--json', 'name,bucket'], [0, 8]);
      return rows.filter(row => row.name !== REQUIRED_STATUS_CONTEXT).map(row => ({ name: row.name, bucket: row.bucket }));
    },
    /** Read submitted reviews and outstanding requests without confusing a request with a review. */
    async readCopilotReviews(number) {
      const query = `query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviews(first:100,after:$after){nodes{state submittedAt body commit{oid} author{login __typename}} pageInfo{hasNextPage endCursor}} reviewRequests(first:100){nodes{requestedReviewer{... on User{login} ... on Bot{login}}} pageInfo{hasNextPage}}}}}`;
      let after = null;
      const reviews = [];
      let pendingRequests = [];
      let hasMoreRequests = false;
      do {
        const data = graph(query, { owner, name, number, after });
        const pullRequest = data.data?.repository?.pullRequest;
        if (!pullRequest) throw new Error(`Pull request #${number} was not found in ${repositoryName}.`);
        reviews.push(...pullRequest.reviews.nodes.map(review => ({
          authorLogin: review.author?.login ?? null,
          authorType: review.author?.__typename ?? null,
          commitOid: review.commit?.oid ?? null,
          state: review.state,
          submitted: review.submittedAt != null,
          submittedAt: review.submittedAt ?? null,
          errored: typeof review.body === 'string' && COPILOT_ERROR_BODY.test(review.body),
        })));
        pendingRequests = pullRequest.reviewRequests.nodes.map(request => request.requestedReviewer?.login ?? null);
        hasMoreRequests = pullRequest.reviewRequests.pageInfo.hasNextPage;
        const pageInfo = pullRequest.reviews.pageInfo;
        if (pageInfo.hasNextPage && !pageInfo.endCursor) throw new Error('GitHub omitted the Copilot review pagination cursor.');
        after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
      } while (after !== null);
      return { reviews, pendingRequests, pendingRequestsUnread: hasMoreRequests };
    },
    /** Preserve the supervisor's own scope and evidence in a PR comment. */
    async createReviewRecord(record) {
      const result = runJson(['api', `${restPrefix}/issues/${record.pullRequestNumber}/comments`, '-X', 'POST', '-f', `body=${record.body}`]);
      return result.html_url;
    },
    /** Publish status only to the supplied commit and context. */
    async setCommitStatus(status) {
      const result = runJson([
        'api', `${restPrefix}/statuses/${status.sha}`, '-X', 'POST',
        '-f', `state=${status.state}`, '-f', `context=${status.context}`,
        '-f', `description=${status.description}`, '-f', `target_url=${status.targetUrl}`,
      ]);
      if (result.context !== status.context || result.state !== status.state) {
        throw new Error('GitHub did not confirm the requested status context and state.');
      }
      // The create-status endpoint omits `sha`; the request path binds this response to it.
      return { sha: status.sha, context: result.context, state: result.state };
    },
    /** Read back the newest status matching this context on the expected commit. */
    async readCommitStatus(sha, context) {
      const combined = runJson(['api', `${restPrefix}/commits/${sha}/status`]);
      if (combined.sha !== sha) throw new Error(`Combined status belongs to ${combined.sha}, not ${sha}.`);
      const status = combined.statuses.find(candidate => candidate.context === context);
      if (!status) throw new Error(`No ${context} status was found for ${sha}.`);
      return { sha: combined.sha, context: status.context, state: status.state };
    },
    /** Arm native auto-merge with GitHub's expected-head comparison. */
    async enableAutoMerge(request) {
      const pullRequestQuery = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){id}}}`;
      const pullRequest = graph(pullRequestQuery, { owner, name, number: request.pullRequestNumber }).data.repository.pullRequest;
      const mutation = `mutation($pullRequestId:ID!,$expectedHeadOid:GitObjectID!){enablePullRequestAutoMerge(input:{pullRequestId:$pullRequestId,expectedHeadOid:$expectedHeadOid}){pullRequest{headRefOid autoMergeRequest{enabledAt}}}}`;
      const data = graph(mutation, { pullRequestId: pullRequest.id, expectedHeadOid: request.expectedHeadOid });
      const enabled = data.data?.enablePullRequestAutoMerge?.pullRequest;
      if (!enabled || enabled.headRefOid !== request.expectedHeadOid || enabled.autoMergeRequest === null) {
        throw new Error('GitHub did not confirm auto-merge for the expected head.');
      }
      return { enabled: true, expectedHeadOid: enabled.headRefOid };
    },
    /** Confirm current head and whether GitHub retained or completed the merge request. */
    async readOutcome(number) {
      const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid mergedAt autoMergeRequest{enabledAt}}}}`;
      const pullRequest = graph(query, { owner, name, number }).data.repository.pullRequest;
      return {
        headRefOid: pullRequest.headRefOid,
        autoMergeEnabled: pullRequest.autoMergeRequest !== null,
        merged: pullRequest.mergedAt !== null,
      };
    },
  };
}

/** Parse the small fixed command surface without a dependency or shell interpretation. */
function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!['--pr', '--head', '--scope', '--evidence'].includes(name) || index + 1 >= args.length) {
      throw new Error('Usage: node tooling/supervisor-review.mjs --pr N --head SHA --scope TEXT --evidence TEXT');
    }
    if (values.has(name)) throw new Error(`Option ${name} may only be provided once.`);
    values.set(name, args[index + 1]);
  }
  if (values.size !== 4) throw new Error('All four options are required: --pr, --head, --scope, and --evidence.');
  const pullRequestNumber = Number(values.get('--pr'));
  if (!Number.isSafeInteger(pullRequestNumber) || String(pullRequestNumber) !== values.get('--pr')) {
    throw new Error('--pr must be a positive base-10 integer.');
  }
  return {
    pullRequestNumber,
    expectedHeadOid: values.get('--head'),
    scope: values.get('--scope'),
    evidence: values.get('--evidence'),
  };
}

/** Keep direct execution separate from imports so the state machine remains deterministic in tests. */
async function main(args) {
  const request = parseArguments(args);
  const result = await runSupervisorReview(request, createGitHubApi(TARGET_REPOSITORY));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Supervisor review stopped: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
