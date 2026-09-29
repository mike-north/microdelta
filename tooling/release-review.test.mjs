/**
 * The human-operated release review records the protected, exact-head
 * **Supervisor review** status on a Changesets Version Packages PR so a
 * maintainer can merge it manually. It keeps every supervisor gate, requires
 * completed passing checks and a genuine completed Copilot review of the pull request, and never
 * arms auto-merge or merges: the maintainer's manual merge is the release
 * decision (issue #64 review finding 1).
 *
 * @see https://docs.github.com/en/rest/commits/statuses#create-a-commit-status
 * @see https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runReleaseReview } from './release-review.mjs';
import { REQUIRED_BRANCH_CHECKS, REQUIRED_STATUS_CONTEXT, runSupervisorReview } from './supervisor-review.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const prNumber = 49;
const releaseHead = 'e'.repeat(40);

/** A Version Packages PR whose gates all pass, with an injected GitHub boundary. */
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
      title: 'Version Packages',
      baseRefName: 'main',
      headRefName: 'changeset-release/main',
      headRepositoryNameWithOwner: 'mike-north/microdelta',
      headRefOid: releaseHead,
      url: `https://github.com/mike-north/microdelta/pull/${prNumber}`,
      unresolvedThreads: 0,
      autoMergeEnabled: false,
      merged: false,
      isReleaseVersion: true,
    },
    requiredChecks: [
      ...REQUIRED_BRANCH_CHECKS.map(name => ({ name, bucket: 'pass' })),
      { name: REQUIRED_STATUS_CONTEXT, bucket: 'pending' },
    ],
    copilotReviews: [{
      authorLogin: 'copilot-pull-request-reviewer[bot]',
      authorType: 'Bot',
      commitOid: releaseHead,
      state: 'COMMENTED',
      submitted: true,
    }],
    pendingReviewRequests: [],
    armAutoMergeAfterStatus: false,
    ...overrides,
  };
  let pullRequestReads = 0;
  const api = {
    async readRepository() { calls.push(['readRepository']); return state.repository; },
    async readProtection(branch) { calls.push(['readProtection', branch]); return state.protection; },
    async readPullRequest(number) {
      calls.push(['readPullRequest', number]);
      pullRequestReads += 1;
      if (state.changeHeadOnRead === pullRequestReads) state.pullRequest.headRefOid = 'f'.repeat(40);
      return { ...state.pullRequest };
    },
    async readRequiredChecks(number) { calls.push(['readRequiredChecks', number]); return state.requiredChecks; },
    async readCopilotReviews(number) {
      calls.push(['readCopilotReviews', number]);
      return { reviews: state.copilotReviews, pendingRequests: state.pendingReviewRequests };
    },
    async createReviewRecord(record) { calls.push(['createReviewRecord', record]); return `${state.pullRequest.url}#issuecomment-9`; },
    async setCommitStatus(status) {
      calls.push(['setCommitStatus', status]);
      if (status.state === 'success' && state.armAutoMergeAfterStatus) state.pullRequest.autoMergeEnabled = true;
      return { sha: status.sha, context: status.context, state: status.state };
    },
    async readCommitStatus(sha, context) { calls.push(['readCommitStatus', sha, context]); return { sha, context, state: 'success' }; },
    async enableAutoMerge() { calls.push(['enableAutoMerge']); throw new Error('release review must never arm auto-merge'); },
    async readOutcome(number) {
      calls.push(['readOutcome', number]);
      return { headRefOid: state.pullRequest.headRefOid, autoMergeEnabled: state.pullRequest.autoMergeEnabled, merged: state.pullRequest.merged };
    },
  };
  const confirmations = [];
  const request = {
    pullRequestNumber: prNumber,
    expectedHeadOid: releaseHead,
    scope: 'Reviewed generated versions, changelogs and internal ranges for every package.',
    evidence: 'Versions select 0.1.0 and 0.0.1; no package remains at 0.0.0; changelogs match the changesets.',
    verification: 'Fresh clone of the head: npm ci, npm run check, npm test, npm run build all exited 0.',
    async confirm(summary) {
      confirmations.push(summary);
      return state.typedConfirmation ?? releaseHead.slice(0, 12);
    },
  };
  return { api, calls, confirmations, request, state };
}

/** Names of state-changing GitHub calls, in order. */
function writes(calls) {
  return calls.filter(([name]) => ['createReviewRecord', 'setCommitStatus', 'enableAutoMerge'].includes(name));
}

test('records exact-head release review status without arming auto-merge or merging', async () => {
  const { api, calls, confirmations, request } = scenario();
  const result = await runReleaseReview(request, api);
  assert.deepEqual(result, { expectedHeadOid: releaseHead, reviewComment: `https://github.com/mike-north/microdelta/pull/${prNumber}#issuecomment-9`, outcome: 'awaiting-manual-merge' });
  assert.ok(!calls.some(([name]) => name === 'enableAutoMerge'));
  const statuses = calls.filter(([name]) => name === 'setCommitStatus').map(([, status]) => status);
  assert.deepEqual(statuses.map(status => status.state), ['pending', 'success']);
  assert.ok(statuses.every(status => status.sha === releaseHead && status.context === REQUIRED_STATUS_CONTEXT));
  assert.match(statuses[1].description, /merge manually to release/u);
  const record = calls.find(([name]) => name === 'createReviewRecord')[1].body;
  assert.match(record, /Release review for `e{40}`/u);
  assert.match(record, /Scope: Reviewed generated versions/u);
  assert.match(record, /Evidence: Versions select/u);
  assert.match(record, /Fresh verification: Fresh clone of the head/u);
  assert.match(record, /does not merge or arm auto-merge/u);
  assert.match(record, /manual merge of this PR is the release decision/u);
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0], /#49/u);
  assert.match(confirmations[0], /e{40}/u);
  assert.match(confirmations[0], /publishes to npm/u);
  assert.ok(calls.some(([name, sha]) => name === 'readCommitStatus' && sha === releaseHead));
});

for (const [name, overrides, requestOverrides = {}, pattern] of [
  ['an ordinary feature PR', { pullRequest: { ...scenario().state.pullRequest, title: 'Fix runtime behavior', headRefName: 'fix-runtime', isReleaseVersion: false } }, {}, /only for the Changesets Version Packages PR/u],
  ['a release title on another branch', { pullRequest: { ...scenario().state.pullRequest, headRefName: 'version-packages' } }, {}, /head branch changeset-release\/main/u],
  ['a version branch from another repository', { pullRequest: { ...scenario().state.pullRequest, headRepositoryNameWithOwner: 'someone/microdelta' } }, {}, /head branch changeset-release\/main in mike-north\/microdelta/u],
  ['a version branch without the Version Packages title', { pullRequest: { ...scenario().state.pullRequest, title: 'Release tweaks' } }, {}, /only for the Changesets Version Packages PR/u],
  ['armed auto-merge', { pullRequest: { ...scenario().state.pullRequest, autoMergeEnabled: true } }, {}, /Auto-merge is enabled; a release PR must be merged manually/u],
  ['a merged release PR', { pullRequest: { ...scenario().state.pullRequest, merged: true } }, {}, /open and unmerged/u],
  ['a draft release PR', { pullRequest: { ...scenario().state.pullRequest, isDraft: true } }, {}, /Draft/u],
  ['a changed head', { pullRequest: { ...scenario().state.pullRequest, headRefOid: 'f'.repeat(40) } }, {}, /head changed/u],
  ['unresolved conversations', { pullRequest: { ...scenario().state.pullRequest, unresolvedThreads: 2 } }, {}, /Resolve all review conversations/u],
  ['pending required CI', { requiredChecks: [{ name: 'PR metadata', bucket: 'pass' }, { name: 'core (20)', bucket: 'pending' }, { name: 'core (22)', bucket: 'pass' }, { name: 'core (24)', bucket: 'pass' }] }, {}, /must have completed successfully on the exact head: core \(20\)/u],
  ['skipped required CI', { requiredChecks: [{ name: 'PR metadata', bucket: 'skipping' }, { name: 'core (20)', bucket: 'pass' }, { name: 'core (22)', bucket: 'pass' }, { name: 'core (24)', bucket: 'pass' }] }, {}, /must have completed successfully on the exact head: PR metadata/u],
  ['failed required CI', { requiredChecks: [{ name: 'PR metadata', bucket: 'pass' }, { name: 'core (20)', bucket: 'pass' }, { name: 'core (22)', bucket: 'fail' }, { name: 'core (24)', bucket: 'pass' }] }, {}, /non-passing results: core \(22\)/u],
  ['missing required CI', { requiredChecks: [{ name: 'PR metadata', bucket: 'pass' }] }, {}, /Required CI results are missing/u],
  ['no Copilot review', { copilotReviews: [] }, {}, /completed Copilot COMMENTED or APPROVED review/u],
  ['only an errored Copilot run', { copilotReviews: [{ authorLogin: 'copilot-pull-request-reviewer[bot]', authorType: 'Bot', commitOid: releaseHead, state: 'COMMENTED', submitted: true, errored: true }] }, {}, /completed Copilot COMMENTED or APPROVED review/u],
  ['a Copilot login from a user account', { copilotReviews: [{ authorLogin: 'copilot-pull-request-reviewer', authorType: 'User', commitOid: releaseHead, state: 'COMMENTED', submitted: true }] }, {}, /completed Copilot COMMENTED or APPROVED review/u],
  ['an outstanding Copilot request', { pendingReviewRequests: ['copilot-pull-request-reviewer[bot]'] }, {}, /still requested/u],
  ['protection without Supervisor review', { protection: { ...scenario().state.protection, requiredContexts: [...REQUIRED_BRANCH_CHECKS] } }, {}, /missing required checks: Supervisor review/u],
  ['protection without administrator enforcement', { protection: { ...scenario().state.protection, enforceAdmins: false } }, {}, /administrators/u],
  ['missing scope', {}, { scope: ' ' }, /Review scope is required/u],
  ['missing evidence', {}, { evidence: '' }, /Review evidence is required/u],
  ['missing fresh verification', {}, { verification: '' }, /Fresh verification evidence is required/u],
  ['a mistyped human confirmation', { typedConfirmation: 'eeeeeeeeeee0' }, {}, /Confirmation did not match/u],
  ['a missing human confirmation', {}, { confirm: undefined }, /interactive human confirmation/u],
]) {
  test(`refuses ${name} before any comment or status write`, async () => {
    const { api, calls, request } = scenario(overrides);
    await assert.rejects(runReleaseReview({ ...request, ...requestOverrides }, api), pattern);
    assert.deepEqual(writes(calls), []);
  });
}

test('a head change after the pending status leaves no success status', async () => {
  const { api, calls, request } = scenario({ changeHeadOnRead: 2 });
  await assert.rejects(runReleaseReview(request, api), /head changed/u);
  const statuses = calls.filter(([name]) => name === 'setCommitStatus').map(([, status]) => status.state);
  assert.deepEqual(statuses, ['pending']);
  assert.ok(!calls.some(([name]) => name === 'enableAutoMerge'));
});

test('auto-merge armed by someone else during review is reported, never accepted', async () => {
  const { api, calls, request } = scenario({ armAutoMergeAfterStatus: true });
  await assert.rejects(runReleaseReview(request, api), /Auto-merge was enabled on the release PR; disable it/u);
  assert.ok(!calls.some(([name]) => name === 'enableAutoMerge'));
});

test('the ordinary supervisor command still refuses release PRs and never arms them', async () => {
  const { api, calls, request } = scenario();
  await assert.rejects(runSupervisorReview(request, api), /Release-version pull requests remain under human-controlled release procedure/u);
  assert.deepEqual(writes(calls), []);
});

test('the CLI refuses to run without an interactive terminal and makes no GitHub call', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-release-review-cli-'));
  try {
    const log = path.join(directory, 'gh.log');
    await writeFile(path.join(directory, 'gh'), `#!/bin/sh\necho "$@" >> '${log}'\nexit 1\n`);
    await chmod(path.join(directory, 'gh'), 0o755);
    const child = spawn(process.execPath, [
      path.join(root, 'tooling/release-review.mjs'),
      '--pr', '49', '--head', releaseHead,
      '--scope', 'Reviewed.', '--evidence', 'Checked.', '--verification', 'Fresh gates passed.',
    ], { env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}` }, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end();
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const status = await new Promise(resolve => child.on('close', resolve));
    assert.equal(status, 1);
    assert.match(stderr, /requires an interactive terminal operated by a human maintainer/u);
    assert.equal(await readFile(log, 'utf8').catch(() => ''), '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the CLI requires every option exactly once', async () => {
  const child = spawn(process.execPath, [path.join(root, 'tooling/release-review.mjs'), '--pr', '49', '--head', releaseHead], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const status = await new Promise(resolve => child.on('close', resolve));
  assert.equal(status, 1);
  assert.match(stderr, /--pr, --head, --scope, --evidence, and --verification are required/u);
});
