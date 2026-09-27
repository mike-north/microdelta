/** Issue #34 tests keep review evidence and merge authority tied to one PR head. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_STATUS_CONTEXT,
  REQUIRED_BRANCH_CHECKS,
  createGitHubApi,
  runSupervisorReview,
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
  ['Copilot review on an older head', { copilotReviews: [{ authorLogin: 'copilot-pull-request-reviewer', authorType: 'Bot', commitOid: 'b'.repeat(40), state: 'COMMENTED', submitted: true }] }],
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
