/** Issue #34 tests keep review evidence and merge authority tied to one PR head. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_STATUS_CONTEXT,
  REQUIRED_BRANCH_CHECKS,
  createGitHubApi,
  runSupervisorReview,
  validateProtection,
} from './supervisor-review.mjs';

const prNumber = 34;
const reviewedHead = 'a'.repeat(40);

function scenario(overrides = {}) {
  const calls = [];
  const state = {
    repository: { nameWithOwner: 'mike-north/microdelta', defaultBranch: 'main' },
    protection: {
      branch: 'main',
      requiresPullRequest: true,
      strict: true,
      enforceAdmins: true,
      resolveConversations: true,
      requiredContexts: [...REQUIRED_BRANCH_CHECKS, REQUIRED_STATUS_CONTEXT],
      checkSources: Object.fromEntries(REQUIRED_BRANCH_CHECKS.map(name => [name, 'github-actions'])),
    },
    pullRequest: {
      number: prNumber,
      state: 'OPEN',
      isDraft: false,
      title: 'Fix runtime behavior',
      isReleaseVersion: false,
      baseRefName: 'main',
      headRefOid: reviewedHead,
      url: `https://github.com/mike-north/microdelta/pull/${prNumber}`,
      unresolvedThreads: 0,
      autoMergeEnabled: false,
      merged: false,
    },
    requiredChecks: [
      { name: 'PR metadata', bucket: 'pass' },
      { name: 'core (20)', bucket: 'pending' },
      { name: 'core (22)', bucket: 'pass' },
      { name: 'core (24)', bucket: 'pass' },
      { name: REQUIRED_STATUS_CONTEXT, bucket: 'pending' },
    ],
    copilotReviews: [{
      authorLogin: 'copilot-pull-request-reviewer[bot]',
      authorType: 'Bot',
      commitOid: reviewedHead,
      state: 'COMMENTED',
      submitted: true,
    }],
    pendingReviewRequests: [],
    ...overrides,
  };
  let readPullRequestCount = 0;
  const api = {
    async readRepository() { calls.push(['readRepository']); return state.repository; },
    async readProtection(branch) { calls.push(['readProtection', branch]); return state.protection; },
    async readPullRequest(number) {
      calls.push(['readPullRequest', number]);
      readPullRequestCount++;
      if (state.changeHeadOnRead === readPullRequestCount) state.pullRequest.headRefOid = 'b'.repeat(40);
      return { ...state.pullRequest };
    },
    async readRequiredChecks(number, sha) { calls.push(['readRequiredChecks', number, sha]); return state.requiredChecks; },
    async readCopilotReviews(number) {
      calls.push(['readCopilotReviews', number]);
      return { reviews: state.copilotReviews, pendingRequests: state.pendingReviewRequests };
    },
    async createReviewRecord(record) { calls.push(['createReviewRecord', record]); return `${state.pullRequest.url}#issuecomment-123`; },
    async setCommitStatus(status) {
      calls.push(['setCommitStatus', status]);
      return { sha: status.sha, context: status.context, state: status.state };
    },
    async readCommitStatus(sha, context) {
      calls.push(['readCommitStatus', sha, context]);
      return { sha, context, state: 'success' };
    },
    async enableAutoMerge(request) {
      calls.push(['enableAutoMerge', request]);
      if (state.changeHeadOnEnable) state.pullRequest.headRefOid = 'b'.repeat(40);
      if (state.pullRequest.headRefOid !== request.expectedHeadOid) throw new Error('head changed at auto-merge boundary');
      state.pullRequest.autoMergeEnabled = true;
      return { enabled: true, expectedHeadOid: request.expectedHeadOid };
    },
    async readOutcome(number) {
      calls.push(['readOutcome', number]);
      return { headRefOid: state.pullRequest.headRefOid, autoMergeEnabled: state.pullRequest.autoMergeEnabled, merged: state.pullRequest.merged };
    },
  };
  const request = {
    pullRequestNumber: prNumber,
    expectedHeadOid: reviewedHead,
    scope: 'Reviewed the runtime and workflow changes against issue 34 acceptance.',
    evidence: 'No blocking findings remain; required checks may finish independently.',
  };
  return { api, calls, request, state };
}

test('arms auto-merge for the reviewed head while required CI is still pending', async () => {
  const { api, calls, request } = scenario();
  const result = await runSupervisorReview(request, api);

  assert.equal(result.expectedHeadOid, reviewedHead);
  assert.equal(result.outcome, 'awaiting-required-checks');
  const statusCalls = calls.filter(([name]) => name === 'setCommitStatus').map(([, value]) => value);
  assert.deepEqual(statusCalls.map(status => status.state), ['pending', 'success']);
  assert.ok(statusCalls.every(status => status.sha === reviewedHead && status.context === REQUIRED_STATUS_CONTEXT));
  assert.ok(calls.some(([name, number]) => name === 'readCopilotReviews' && number === prNumber));
  assert.ok(calls.some(([name, sha, context]) => name === 'readCommitStatus' && sha === reviewedHead && context === REQUIRED_STATUS_CONTEXT));
  const arm = calls.find(([name]) => name === 'enableAutoMerge')?.[1];
  assert.deepEqual(arm, { pullRequestNumber: prNumber, expectedHeadOid: reviewedHead });
  assert.ok(calls.findIndex(([name, status]) => name === 'setCommitStatus' && status.state === 'success') > calls.findIndex(([name]) => name === 'enableAutoMerge'));
  assert.match(calls.find(([name]) => name === 'createReviewRecord')[1].body, /issue 34 acceptance/u);
});

for (const [name, overrides, requestOverrides = {}] of [
  ['changed head at preflight', { pullRequest: { number: prNumber, state: 'OPEN', isDraft: false, baseRefName: 'main', headRefOid: 'b'.repeat(40), url: 'https://github.com/mike-north/microdelta/pull/34', unresolvedThreads: 0, autoMergeEnabled: false } }],
  ['closed pull request', { pullRequest: { number: prNumber, state: 'CLOSED', isDraft: false, baseRefName: 'main', headRefOid: reviewedHead, url: 'https://github.com/mike-north/microdelta/pull/34', unresolvedThreads: 0, autoMergeEnabled: false } }],
  ['draft pull request', { pullRequest: { number: prNumber, state: 'OPEN', isDraft: true, baseRefName: 'main', headRefOid: reviewedHead, url: 'https://github.com/mike-north/microdelta/pull/34', unresolvedThreads: 0, autoMergeEnabled: false } }],
  ['wrong base branch', { pullRequest: { number: prNumber, state: 'OPEN', isDraft: false, baseRefName: 'release', headRefOid: reviewedHead, url: 'https://github.com/mike-north/microdelta/pull/34', unresolvedThreads: 0, autoMergeEnabled: false } }],
  ['release-version title', { pullRequest: { number: prNumber, state: 'OPEN', isDraft: false, title: 'Version Packages (prerelease)', baseRefName: 'main', headRefOid: reviewedHead, url: 'https://github.com/mike-north/microdelta/pull/34', unresolvedThreads: 0, autoMergeEnabled: false } }],
  ['release-version branch', { pullRequest: { number: prNumber, state: 'OPEN', isDraft: false, headRefName: 'changeset-release/main', baseRefName: 'main', headRefOid: reviewedHead, url: 'https://github.com/mike-north/microdelta/pull/34', unresolvedThreads: 0, autoMergeEnabled: false } }],
  ['unresolved review conversations', { pullRequest: { number: prNumber, state: 'OPEN', isDraft: false, baseRefName: 'main', headRefOid: reviewedHead, url: 'https://github.com/mike-north/microdelta/pull/34', unresolvedThreads: 1, autoMergeEnabled: false } }],
  ['missing review scope', {}, { scope: ' ' }],
  ['missing review evidence', {}, { evidence: '' }],
  ['failed required core CI', { requiredChecks: [
    { name: 'PR metadata', bucket: 'pass' },
    { name: 'core (20)', bucket: 'fail' },
    { name: 'core (22)', bucket: 'pass' },
    { name: 'core (24)', bucket: 'pass' },
    { name: REQUIRED_STATUS_CONTEXT, bucket: 'pending' },
  ] }],
  ['no completed Copilot review', { copilotReviews: [] }],
  ['only an errored Copilot run', { copilotReviews: [{ authorLogin: 'copilot-pull-request-reviewer[bot]', authorType: 'Bot', commitOid: reviewedHead, state: 'COMMENTED', submitted: true, submittedAt: '2026-09-27T00:00:00Z', errored: true }] }],
  ['latest Copilot review requests changes after an earlier comment', { copilotReviews: [
    { authorLogin: 'copilot-pull-request-reviewer[bot]', authorType: 'Bot', commitOid: 'b'.repeat(40), state: 'COMMENTED', submitted: true, submittedAt: '2026-09-27T00:00:00Z' },
    { authorLogin: 'copilot-pull-request-reviewer[bot]', authorType: 'Bot', commitOid: reviewedHead, state: 'CHANGES_REQUESTED', submitted: true, submittedAt: '2026-09-28T00:00:00Z' },
  ] }],
  ['dismissed Copilot review', { copilotReviews: [{ authorLogin: 'copilot-pull-request-reviewer[bot]', authorType: 'Bot', commitOid: reviewedHead, state: 'DISMISSED', submitted: true }] }],
  ['pending Copilot review', { copilotReviews: [{ authorLogin: 'copilot-pull-request-reviewer[bot]', authorType: 'Bot', commitOid: reviewedHead, state: 'PENDING', submitted: false }] }],
  ['review authored by a different account', { copilotReviews: [{ authorLogin: 'reviewer', commitOid: reviewedHead, state: 'APPROVED', submitted: true }] }],
  ['Copilot login used by a human account', { copilotReviews: [{ authorLogin: 'copilot-pull-request-reviewer[bot]', authorType: 'User', commitOid: reviewedHead, state: 'COMMENTED', submitted: true }] }],
  ['Copilot requested but not submitted', { pendingReviewRequests: ['copilot-pull-request-reviewer[bot]'] }],
  ['Copilot requested changes', { copilotReviews: [{ authorLogin: 'copilot-pull-request-reviewer[bot]', authorType: 'Bot', commitOid: reviewedHead, state: 'CHANGES_REQUESTED', submitted: true }] }],
  ['supervisor review is not required by protection', { protection: {
    branch: 'main', requiresPullRequest: true, strict: true, enforceAdmins: true,
    resolveConversations: true, requiredContexts: [...REQUIRED_BRANCH_CHECKS],
  } }],
  ['required review protection is absent', { protection: {
    branch: 'main', requiresPullRequest: true, strict: true, enforceAdmins: true,
    resolveConversations: true,
    requiredContexts: [...REQUIRED_BRANCH_CHECKS],
    checkSources: Object.fromEntries(REQUIRED_BRANCH_CHECKS.map(name => [name, 'github-actions'])),
  } }],
  ['an existing GitHub Actions source restriction is missing', { protection: {
    branch: 'main', requiresPullRequest: true, strict: true, enforceAdmins: true,
    resolveConversations: true,
    requiredContexts: [...REQUIRED_BRANCH_CHECKS, REQUIRED_STATUS_CONTEXT],
    checkSources: { ...Object.fromEntries(REQUIRED_BRANCH_CHECKS.map(name => [name, 'github-actions'])), 'core (22)': null },
  } }],
]) {
  test(`fails closed for ${name} before any review or status write`, async () => {
    const { api, calls, request } = scenario(overrides);
    await assert.rejects(runSupervisorReview({ ...request, ...requestOverrides }, api));
    assert.equal(calls.some(([call]) => ['createReviewRecord', 'setCommitStatus', 'enableAutoMerge'].includes(call)), false);
  });
}

test('a completed Copilot review on an earlier head of the PR satisfies the per-PR review gate', async () => {
  const { api, request, state } = scenario();
  state.copilotReviews = [{ authorLogin: 'copilot-pull-request-reviewer[bot]', authorType: 'Bot', commitOid: 'b'.repeat(40), state: 'COMMENTED', submitted: true, submittedAt: '2026-09-27T00:00:00Z' }];
  const result = await runSupervisorReview(request, api);
  assert.equal(result.expectedHeadOid, reviewedHead);
});

test('an errored Copilot rerun does not erase an earlier completed Copilot review', async () => {
  const { api, request, state } = scenario();
  state.copilotReviews = [
    { authorLogin: 'copilot-pull-request-reviewer[bot]', authorType: 'Bot', commitOid: 'b'.repeat(40), state: 'COMMENTED', submitted: true, submittedAt: '2026-09-27T00:00:00Z' },
    { authorLogin: 'copilot-pull-request-reviewer[bot]', authorType: 'Bot', commitOid: reviewedHead, state: 'COMMENTED', submitted: true, submittedAt: '2026-09-28T00:00:00Z', errored: true },
  ];
  const result = await runSupervisorReview(request, api);
  assert.equal(result.expectedHeadOid, reviewedHead);
});

test('a head change after pending status but before arming leaves no success or auto-merge request', async () => {
  const { api, calls, request, state } = scenario({ changeHeadOnRead: 2 });
  await assert.rejects(runSupervisorReview(request, api), /head/u);
  const statuses = calls.filter(([name]) => name === 'setCommitStatus').map(([, status]) => status.state);
  assert.deepEqual(statuses, ['pending']);
  assert.equal(state.pullRequest.autoMergeEnabled, false);
  assert.equal(calls.some(([name]) => name === 'enableAutoMerge'), false);
});

test('the expected-head API guard rejects a push in the arming race without releasing review', async () => {
  const { api, calls, request, state } = scenario({ changeHeadOnEnable: true });
  await assert.rejects(runSupervisorReview(request, api), /head changed at auto-merge boundary/u);
  const statuses = calls.filter(([name]) => name === 'setCommitStatus').map(([, status]) => status.state);
  assert.deepEqual(statuses, ['pending']);
  assert.equal(state.pullRequest.autoMergeEnabled, false);
});

test('pending checks remain required and no administrator bypass is requested', async () => {
  const { api, calls, request } = scenario();
  await runSupervisorReview(request, api);
  const arm = calls.find(([name]) => name === 'enableAutoMerge')?.[1];
  assert.deepEqual(Object.keys(arm).sort(), ['expectedHeadOid', 'pullRequestNumber']);
});

test('already-passing CI is still eligible for the exact-head review flow', async () => {
  const { api, calls, request } = scenario({ requiredChecks: [
    { name: 'PR metadata', bucket: 'pass' },
    { name: 'core (20)', bucket: 'pass' },
    { name: 'core (22)', bucket: 'pass' },
    { name: 'core (24)', bucket: 'pass' },
    { name: REQUIRED_STATUS_CONTEXT, bucket: 'pending' },
  ] });
  const result = await runSupervisorReview(request, api);
  assert.equal(result.outcome, 'ready');
  assert.ok(calls.some(([name]) => name === 'enableAutoMerge'));
});

for (const checks of [
  [
    { name: 'core (20)', bucket: 'pass' },
    { name: 'core (20)', bucket: 'fail' },
  ],
  [
    { name: 'core (20)', bucket: 'fail' },
    { name: 'core (20)', bucket: 'pass' },
  ],
]) {
  test('a failing duplicate required check blocks even when a passing duplicate is present', async () => {
    const { api, calls, request } = scenario({ requiredChecks: [
      { name: 'PR metadata', bucket: 'pass' },
      ...checks,
      { name: 'core (22)', bucket: 'pass' },
      { name: 'core (24)', bucket: 'pass' },
    ] });
    await assert.rejects(runSupervisorReview(request, api), /non-passing/u);
    assert.equal(calls.some(([name]) => ['createReviewRecord', 'setCommitStatus', 'enableAutoMerge'].includes(name)), false);
  });
}

for (const duplicateChecks of [
  [{ name: 'core (20)', bucket: 'pass' }, { name: 'core (20)', bucket: 'pending' }],
  [{ name: 'core (20)', bucket: 'pending' }, { name: 'core (20)', bucket: 'pass' }],
]) {
  test('a pending duplicate required check remains classified as pending in either response order', async () => {
    const { api, request } = scenario({ requiredChecks: [
      { name: 'PR metadata', bucket: 'pass' },
      ...duplicateChecks,
      { name: 'core (22)', bucket: 'pass' },
      { name: 'core (24)', bucket: 'pass' },
    ] });
    assert.equal((await runSupervisorReview(request, api)).outcome, 'awaiting-required-checks');
  });
}

test('status adapter accepts GitHub individual-status responses without sha and reads the combined exact-commit status', async () => {
  const calls = [];
  const api = createGitHubApi('mike-north/microdelta', args => {
    calls.push(args);
    if (args[1] === `repos/mike-north/microdelta/statuses/${reviewedHead}`) {
      return { url: 'https://api.github.com/repos/mike-north/microdelta/statuses/123', context: REQUIRED_STATUS_CONTEXT, state: 'success' };
    }
    if (args[1] === `repos/mike-north/microdelta/commits/${reviewedHead}/status`) {
      return { sha: reviewedHead, statuses: [
        { context: REQUIRED_STATUS_CONTEXT, state: 'success', target_url: 'https://github.com/mike-north/microdelta/pull/34#issuecomment-123' },
      ] };
    }
    throw new Error(`Unexpected endpoint: ${args[1]}`);
  });

  assert.deepEqual(await api.setCommitStatus({
    sha: reviewedHead,
    context: REQUIRED_STATUS_CONTEXT,
    state: 'success',
    description: 'Reviewed current head.',
    targetUrl: 'https://github.com/mike-north/microdelta/pull/34#issuecomment-123',
  }), { sha: reviewedHead, context: REQUIRED_STATUS_CONTEXT, state: 'success' });
  assert.deepEqual(await api.readCommitStatus(reviewedHead, REQUIRED_STATUS_CONTEXT), {
    sha: reviewedHead,
    context: REQUIRED_STATUS_CONTEXT,
    state: 'success',
  });
  assert.ok(calls.some(args => args[1] === `repos/mike-north/microdelta/commits/${reviewedHead}/status`));
});

test('status adapter rejects a write response that did not confirm the requested state and context', async () => {
  const api = createGitHubApi('mike-north/microdelta', () => ({
    url: 'https://api.github.com/repos/mike-north/microdelta/statuses/123',
    context: 'another status',
    state: 'failure',
  }));
  await assert.rejects(api.setCommitStatus({
    sha: reviewedHead,
    context: REQUIRED_STATUS_CONTEXT,
    state: 'success',
    description: 'Reviewed current head.',
    targetUrl: 'https://github.com/mike-north/microdelta/pull/34#issuecomment-123',
  }), /did not confirm/u);
});

/** Exercise every production-adapter method with the ambient CLI unavailable. */
test('all GitHub adapter operations use the injected runner with their original arguments', async () => {
  const calls = [];
  const pullRequestUrl = 'https://github.com/mike-north/microdelta/pull/34';
  const originalPath = process.env.PATH;
  process.env.PATH = '';
  const api = createGitHubApi('mike-north/microdelta', (args, acceptedExitCodes) => {
    calls.push({ args, acceptedExitCodes });
    if (args[0] === 'api' && args[1] === 'repos/mike-north/microdelta') {
      return { full_name: 'mike-north/microdelta', default_branch: 'main' };
    }
    if (args[0] === 'api' && args[1] === 'repos/mike-north/microdelta/branches/main/protection') {
      return {
        required_pull_request_reviews: {},
        required_status_checks: { strict: true, contexts: ['core (20)'], checks: [{ context: 'core (20)', app_id: 15368 }] },
        enforce_admins: { enabled: true },
        required_conversation_resolution: { enabled: true },
      };
    }
    if (args[0] === 'api' && args[1] === 'repos/mike-north/microdelta/rules/branches/main?per_page=100') return [];
    if (args[0] === 'pr') return [{ name: 'core (20)', bucket: 'pass' }];
    if (args[0] === 'api' && args[1] === 'repos/mike-north/microdelta/issues/34/comments') {
      return { html_url: `${pullRequestUrl}#issuecomment-123` };
    }
    if (args[0] === 'api' && args[1] === `repos/mike-north/microdelta/statuses/${reviewedHead}`) {
      return { context: REQUIRED_STATUS_CONTEXT, state: 'success' };
    }
    if (args[0] === 'api' && args[1] === `repos/mike-north/microdelta/commits/${reviewedHead}/status`) {
      return { sha: reviewedHead, statuses: [{ context: REQUIRED_STATUS_CONTEXT, state: 'success' }] };
    }
    if (args[0] === 'api' && args[1] === 'graphql') {
      const query = args.find(value => value.startsWith('query=') || value.startsWith('mutation='));
      const after = args.find(value => value.startsWith('after='))?.slice('after='.length);
      if (query?.includes('reviewThreads(first:100')) {
        return { data: { repository: { pullRequest: {
          id: 'PR_NODE', number: prNumber, title: 'Fix runtime behavior', state: 'OPEN', isDraft: false,
          baseRefName: 'main', headRefName: 'fix-runtime', headRepository: { nameWithOwner: 'mike-north/microdelta' }, headRefOid: reviewedHead, url: pullRequestUrl,
          mergedAt: null, autoMergeRequest: null,
          reviewThreads: {
            nodes: after === 'thread-cursor' ? [{ isResolved: false }] : [{ isResolved: true }],
            pageInfo: after === 'thread-cursor'
              ? { hasNextPage: false, endCursor: null }
              : { hasNextPage: true, endCursor: 'thread-cursor' },
          },
        } } } };
      }
      if (query?.includes('reviews(first:100')) {
        const pagedReview = after === 'review-cursor';
        return { data: { repository: { pullRequest: {
          reviews: {
            nodes: [{
              state: pagedReview ? 'APPROVED' : 'COMMENTED',
              submittedAt: '2026-09-27T00:00:00Z',
              body: pagedReview ? 'Looks good.' : 'Copilot encountered an error and was unable to review this pull request. You can try again by re-requesting a review.',
              commit: { oid: reviewedHead },
              author: { login: pagedReview ? 'reviewer' : 'copilot-pull-request-reviewer[bot]', __typename: pagedReview ? 'User' : 'Bot' },
            }],
            pageInfo: pagedReview
              ? { hasNextPage: false, endCursor: null }
              : { hasNextPage: true, endCursor: 'review-cursor' },
          },
          reviewRequests: { nodes: [], pageInfo: { hasNextPage: false } },
        } } } };
      }
      if (query?.includes('enablePullRequestAutoMerge')) {
        return { data: { enablePullRequestAutoMerge: { pullRequest: { headRefOid: reviewedHead, autoMergeRequest: { enabledAt: '2026-09-27T00:00:00Z' } } } } };
      }
      if (query?.includes('mergedAt autoMergeRequest')) {
        return { data: { repository: { pullRequest: { headRefOid: reviewedHead, mergedAt: null, autoMergeRequest: { enabledAt: '2026-09-27T00:00:00Z' } } } } };
      }
      if (query?.includes('pullRequest(number:$number){id}')) {
        return { data: { repository: { pullRequest: { id: 'PR_NODE' } } } };
      }
      throw new Error(`Unexpected GraphQL operation: ${query}`);
    }
    throw new Error(`Unexpected GitHub command: ${args.join(' ')}`);
  });

  try {
    assert.deepEqual(await api.readRepository(), { nameWithOwner: 'mike-north/microdelta', defaultBranch: 'main' });
    assert.deepEqual(await api.readProtection('main'), {
      branch: 'main', requiresPullRequest: true, strict: true, enforceAdmins: true,
      resolveConversations: true, requiredContexts: ['core (20)'], checkSources: { 'core (20)': 'github-actions' },
    });
    assert.deepEqual(await api.readPullRequest(prNumber), {
      number: prNumber, state: 'OPEN', isDraft: false, title: 'Fix runtime behavior', baseRefName: 'main', headRefName: 'fix-runtime',
      headRepositoryNameWithOwner: 'mike-north/microdelta', headRefOid: reviewedHead, url: pullRequestUrl, nodeId: 'PR_NODE', unresolvedThreads: 1,
      autoMergeEnabled: false, merged: false, isReleaseVersion: false,
    });
    assert.deepEqual(await api.readRequiredChecks(prNumber), [{ name: 'core (20)', bucket: 'pass' }]);
    assert.deepEqual(await api.readCopilotReviews(prNumber), {
      reviews: [
        { authorLogin: 'copilot-pull-request-reviewer[bot]', authorType: 'Bot', commitOid: reviewedHead, state: 'COMMENTED', submitted: true, submittedAt: '2026-09-27T00:00:00Z', errored: true },
        { authorLogin: 'reviewer', authorType: 'User', commitOid: reviewedHead, state: 'APPROVED', submitted: true, submittedAt: '2026-09-27T00:00:00Z', errored: false },
      ],
      pendingRequests: [], pendingRequestsUnread: false,
    });
    assert.equal(await api.createReviewRecord({ pullRequestNumber: prNumber, body: 'Reviewed.' }), `${pullRequestUrl}#issuecomment-123`);
    assert.deepEqual(await api.setCommitStatus({
      sha: reviewedHead, context: REQUIRED_STATUS_CONTEXT, state: 'success', description: 'Reviewed.', targetUrl: pullRequestUrl,
    }), { sha: reviewedHead, context: REQUIRED_STATUS_CONTEXT, state: 'success' });
    assert.deepEqual(await api.readCommitStatus(reviewedHead, REQUIRED_STATUS_CONTEXT), {
      sha: reviewedHead, context: REQUIRED_STATUS_CONTEXT, state: 'success',
    });
    assert.deepEqual(await api.enableAutoMerge({ pullRequestNumber: prNumber, expectedHeadOid: reviewedHead }), {
      enabled: true, expectedHeadOid: reviewedHead,
    });
    assert.deepEqual(await api.readOutcome(prNumber), {
      headRefOid: reviewedHead, autoMergeEnabled: true, merged: false,
    });
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }

  assert.deepEqual(calls[0], { args: ['api', 'repos/mike-north/microdelta'], acceptedExitCodes: undefined });
  assert.deepEqual(calls[1], { args: ['api', 'repos/mike-north/microdelta/branches/main/protection'], acceptedExitCodes: undefined });
  assert.deepEqual(calls[2], { args: ['api', 'repos/mike-north/microdelta/rules/branches/main?per_page=100'], acceptedExitCodes: undefined });
  assert.deepEqual(calls[3].args.slice(0, 3), ['api', 'graphql', '-f']);
  assert.ok(calls[3].args.includes('after=null'));
  assert.ok(calls[4].args.includes('after=thread-cursor'));
  assert.deepEqual(calls[5], {
    args: ['pr', 'checks', String(prNumber), '--repo', 'mike-north/microdelta', '--required', '--json', 'name,bucket'],
    acceptedExitCodes: [0, 8],
  });
  const graphCalls = calls.filter(call => call.args[0] === 'api' && call.args[1] === 'graphql');
  assert.equal(graphCalls.length, 7);
  assert.ok(graphCalls.some(call => call.args.includes('after=review-cursor')));
  assert.deepEqual(calls[8], {
    args: ['api', 'repos/mike-north/microdelta/issues/34/comments', '-X', 'POST', '-f', 'body=Reviewed.'],
    acceptedExitCodes: undefined,
  });
  assert.deepEqual(calls[9], {
    args: [
      'api', `repos/mike-north/microdelta/statuses/${reviewedHead}`, '-X', 'POST',
      '-f', `state=success`, '-f', `context=${REQUIRED_STATUS_CONTEXT}`,
      '-f', 'description=Reviewed.', '-f', `target_url=${pullRequestUrl}`,
    ],
    acceptedExitCodes: undefined,
  });
  assert.deepEqual(calls[10], {
    args: ['api', `repos/mike-north/microdelta/commits/${reviewedHead}/status`],
    acceptedExitCodes: undefined,
  });
  assert.ok(graphCalls[4].args.includes('number=34'));
  assert.ok(graphCalls[5].args.includes(`expectedHeadOid=${reviewedHead}`));
  assert.ok(graphCalls.every(call => call.acceptedExitCodes === undefined));
});

/**
 * Issue #90: `main` is governed by a repository ruleset, not legacy branch protection.
 *
 * @see https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch
 * @see https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset
 */
const RULESET_ID = 24154977;
const REPO_PREFIX = 'repos/mike-north/microdelta';
const LEGACY_PATH = `${REPO_PREFIX}/branches/main/protection`;
const RULES_PATH = `${REPO_PREFIX}/rules/branches/main?per_page=100`;

/** Rule payloads shaped like the rules-for-branch response: type, parameters, and owning ruleset. */
function rulesetRules({ rulesetId = RULESET_ID, pullRequest = {}, checks = {}, omit = [], contexts } = {}) {
  const requiredContexts = contexts ?? [
    ...REQUIRED_BRANCH_CHECKS.map(context => ({ context, integration_id: 15368 })),
    { context: REQUIRED_STATUS_CONTEXT, integration_id: null },
  ];
  const rules = [
    { type: 'deletion', ruleset_id: rulesetId },
    { type: 'non_fast_forward', ruleset_id: rulesetId },
    {
      type: 'required_status_checks',
      ruleset_id: rulesetId,
      parameters: { strict_required_status_checks_policy: true, required_status_checks: requiredContexts, ...checks },
    },
    {
      type: 'pull_request',
      ruleset_id: rulesetId,
      parameters: { required_approving_review_count: 0, required_review_thread_resolution: true, ...pullRequest },
    },
    { type: 'copilot_code_review', ruleset_id: rulesetId, parameters: { review_on_push: false } },
  ];
  return rules.filter(rule => !omit.includes(rule.type));
}

/** Runner that serves the legacy, rules-for-branch, and ruleset-detail endpoints from fixtures. */
function protectionRunner({ legacy = 'not-protected', rules = rulesetRules(), rulesets = {} } = {}) {
  const calls = [];
  const runJson = args => {
    calls.push(args);
    if (args[1] === LEGACY_PATH) {
      if (legacy === 'not-protected') throw new Error('GitHub CLI failed: gh: Branch not protected (HTTP 404)');
      return legacy;
    }
    if (args[1] === RULES_PATH) return rules;
    const detail = /rulesets\/(\d+)$/u.exec(args[1] ?? '');
    if (detail) {
      const ruleset = { [RULESET_ID]: { enforcement: 'active', bypass_actors: [] }, ...rulesets }[detail[1]];
      if (!ruleset) throw new Error('GitHub CLI failed: Not Found (HTTP 404)');
      return ruleset;
    }
    throw new Error(`Unexpected GitHub command: ${args.join(' ')}`);
  };
  return { runJson, calls };
}

const readRuleProtection = async fixtures => {
  const { runJson, calls } = protectionRunner(fixtures);
  const protection = await createGitHubApi('mike-north/microdelta', runJson).readProtection('main');
  return { protection, calls };
};

const legacyProtection = {
  required_pull_request_reviews: {},
  required_status_checks: {
    strict: true,
    contexts: [],
    checks: [
      ...REQUIRED_BRANCH_CHECKS.map(context => ({ context, app_id: 15368 })),
      { context: REQUIRED_STATUS_CONTEXT, app_id: null },
    ],
  },
  enforce_admins: { enabled: true },
  required_conversation_resolution: { enabled: true },
};

const alwaysBypass = { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' };

test('ruleset 24154977 alone yields a protection object that passes validateProtection', async () => {
  const { protection, calls } = await readRuleProtection();
  assert.equal(protection.branch, 'main');
  assert.equal(protection.requiresPullRequest, true); // pull_request rule present
  assert.equal(protection.resolveConversations, true); // required_review_thread_resolution: true
  assert.equal(protection.strict, true); // strict_required_status_checks_policy: true
  assert.equal(protection.enforceAdmins, true); // active ruleset, no bypass actors
  assert.deepEqual([...protection.requiredContexts].sort(), [...REQUIRED_BRANCH_CHECKS, REQUIRED_STATUS_CONTEXT].sort());
  assert.deepEqual(protection.checkSources, {
    ...Object.fromEntries(REQUIRED_BRANCH_CHECKS.map(name => [name, 'github-actions'])),
    [REQUIRED_STATUS_CONTEXT]: null, // integration_id null: an unscoped status
  });
  validateProtection(protection, 'main');
  // Read-only: only GETs of the legacy, rules-for-branch, and ruleset-detail endpoints.
  assert.deepEqual(calls, [
    ['api', LEGACY_PATH],
    ['api', RULES_PATH],
    ['api', `${REPO_PREFIX}/rulesets/${RULESET_ID}`],
  ]);
});

test('legacy protection alone still produces the previously normalized object', async () => {
  const { protection } = await readRuleProtection({ legacy: legacyProtection, rules: [] });
  assert.equal(protection.enforceAdmins, true);
  assert.equal(protection.requiresPullRequest, true);
  validateProtection(protection, 'main');
});

test('a requirement is satisfied when either legacy protection or a ruleset enforces it', async () => {
  const legacyWithoutStrict = { ...legacyProtection, required_status_checks: { ...legacyProtection.required_status_checks, strict: false } };
  const { protection } = await readRuleProtection({
    legacy: legacyWithoutStrict,
    rules: rulesetRules({ omit: ['pull_request'], checks: { required_status_checks: [] } }),
  });
  assert.equal(protection.strict, true); // ruleset supplies strict
  assert.equal(protection.requiresPullRequest, true); // legacy supplies PRs
  validateProtection(protection, 'main');
});

test('a requirement absent from both legacy protection and rulesets still fails', async () => {
  const { protection } = await readRuleProtection({
    legacy: { ...legacyProtection, required_conversation_resolution: { enabled: false } },
    rules: rulesetRules({ pullRequest: { required_review_thread_resolution: false } }),
  });
  assert.equal(protection.resolveConversations, false);
  assert.throws(() => validateProtection(protection, 'main'), /does not require resolved conversations/u);
});

test('legacy 404 is tolerated only for an unprotected branch; other legacy failures stay fatal', async () => {
  const runJson = args => {
    if (args[1] === LEGACY_PATH) throw new Error('GitHub CLI failed: Resource not accessible (HTTP 403)');
    return [];
  };
  await assert.rejects(createGitHubApi('mike-north/microdelta', runJson).readProtection('main'), /HTTP 403/u);
});

test('an unreadable ruleset detail fails closed instead of assuming no bypass', async () => {
  const runJson = args => {
    if (args[1] === LEGACY_PATH) throw new Error('GitHub CLI failed: Branch not protected (HTTP 404)');
    if (args[1] === RULES_PATH) return rulesetRules();
    throw new Error('GitHub CLI failed: Not Found (HTTP 404)');
  };
  await assert.rejects(createGitHubApi('mike-north/microdelta', runJson).readProtection('main'), /Not Found/u);
});

test('neither legacy protection nor rules yields a protection that fails validation', async () => {
  const { protection } = await readRuleProtection({ rules: [] });
  assert.equal(protection.enforceAdmins, false); // no contributing ruleset cannot vouch for administrators
  assert.throws(() => validateProtection(protection, 'main'), /does not require pull requests/u);
});

test('a possibly truncated rules-for-branch page fails closed', async () => {
  const many = Array.from({ length: 100 }, () => ({ type: 'deletion', ruleset_id: RULESET_ID }));
  await assert.rejects(readRuleProtection({ rules: many }), /truncat/iu);
});

test('a branch rule without its owning ruleset fails closed instead of skipping its bypass check', async () => {
  const [first, ...rest] = rulesetRules();
  const { ruleset_id: _omitted, ...orphan } = first;
  await assert.rejects(readRuleProtection({ rules: [orphan, ...rest] }), /without its owning ruleset/u);
});

test('a non-array rules-for-branch response fails closed', async () => {
  await assert.rejects(readRuleProtection({ rules: { message: 'unexpected' } }), /malformed branch rules/u);
});

for (const [name, fixtures, expected] of [
  ['an evaluate-mode ruleset', { rulesets: { [RULESET_ID]: { enforcement: 'evaluate', bypass_actors: [] } } }, /does not require pull requests/u],
  ['a disabled ruleset', { rulesets: { [RULESET_ID]: { enforcement: 'disabled', bypass_actors: [] } } }, /does not require pull requests/u],
  ['a bypass actor', { rulesets: { [RULESET_ID]: { enforcement: 'active', bypass_actors: [alwaysBypass] } } }, /does not apply to administrators/u],
  ['a pull-request-only bypass actor', { rulesets: { [RULESET_ID]: { enforcement: 'active', bypass_actors: [{ ...alwaysBypass, bypass_mode: 'pull_request' }] } } }, /does not apply to administrators/u],
  ['a second contributing ruleset with a bypass actor', {
    rules: [...rulesetRules(), { type: 'deletion', ruleset_id: 99 }],
    rulesets: { 99: { enforcement: 'active', bypass_actors: [alwaysBypass] } },
  }, /does not apply to administrators/u],
  ['a missing required context', { rules: rulesetRules({ contexts: [
    { context: 'PR metadata', integration_id: 15368 }, { context: 'core (20)', integration_id: 15368 },
    { context: 'core (22)', integration_id: 15368 }, { context: REQUIRED_STATUS_CONTEXT, integration_id: null },
  ] }) }, /missing required checks: core \(24\)/u],
  ['a missing Supervisor review context', { rules: rulesetRules({ contexts: REQUIRED_BRANCH_CHECKS.map(context => ({ context, integration_id: 15368 })) }) }, /missing required checks: Supervisor review/u],
  ['an Actions context without the Actions integration', { rules: rulesetRules({ contexts: [
    ...REQUIRED_BRANCH_CHECKS.map(context => ({ context, integration_id: context === 'core (22)' ? null : 15368 })),
    { context: REQUIRED_STATUS_CONTEXT, integration_id: null },
  ] }) }, /source restriction is missing for: core \(22\)/u],
  ['an Actions context pinned to a different app', { rules: rulesetRules({ contexts: [
    ...REQUIRED_BRANCH_CHECKS.map(context => ({ context, integration_id: context === 'PR metadata' ? 123 : 15368 })),
    { context: REQUIRED_STATUS_CONTEXT, integration_id: null },
  ] }) }, /source restriction is missing for: PR metadata/u],
  ['a missing pull_request rule', { rules: rulesetRules({ omit: ['pull_request'] }) }, /does not require pull requests/u],
  ['a missing thread-resolution requirement', { rules: rulesetRules({ pullRequest: { required_review_thread_resolution: false } }) }, /does not require resolved conversations/u],
  ['a non-strict status policy', { rules: rulesetRules({ checks: { strict_required_status_checks_policy: false } }) }, /does not require an up-to-date base/u],
  ['a missing required_status_checks rule', { rules: rulesetRules({ omit: ['required_status_checks'] }) }, /does not require an up-to-date base/u],
]) {
  test(`ruleset protection fails validation with a specific message for ${name}`, async () => {
    const { protection } = await readRuleProtection(fixtures);
    assert.throws(() => validateProtection(protection, 'main'), expected);
  });
}

test('ruleset-derived protection blocks runSupervisorReview before any write when a bypass actor exists', async () => {
  const { runJson } = protectionRunner({
    rulesets: { [RULESET_ID]: { enforcement: 'active', bypass_actors: [alwaysBypass] } },
  });
  const ruleApi = createGitHubApi('mike-north/microdelta', runJson);
  const { api, calls, request } = scenario();
  api.readProtection = branch => ruleApi.readProtection(branch);
  await assert.rejects(runSupervisorReview(request, api), /does not apply to administrators/u);
  assert.equal(calls.some(([call]) => ['createReviewRecord', 'setCommitStatus', 'enableAutoMerge'].includes(call)), false);
});
