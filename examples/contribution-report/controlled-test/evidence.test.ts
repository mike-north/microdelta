/** Search success cannot stand in for complete, temporally justified PR/review/comment evidence. */
import { describe, expect, test } from '@jest/globals';
import { loadDiscussion, loadPull } from '../src/controlled/evidence.js';
import type { IRestResponse, IRestTransport } from '../src/controlled/github.js';
import type { IReportScope } from '../src/controlled/model.js';

/** The cutoff excludes post-cutoff creations and unsupported edited historical content. */
const scope: IReportScope = { repositories: ['acme/widget'], start: 1_767_225_600, end: 1_767_398_400, cutoff: 1_767_398_400, observation: 'observation-a' };
/** A real pull-resource ID need not equal its issue-search ID. */
function pull(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  return { id: 71, number: 101, base: { repo: { full_name: 'acme/widget' } }, title: 'Fix widget', body: 'Explanation', state: 'closed', created_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T13:00:00Z', closed_at: '2026-01-01T13:00:00Z', merged_at: '2026-01-01T13:00:00Z', labels: [{ name: 'unread-label' }], ...overrides };
}
/** Each transport script receives no hidden manifest, only requests. */
function scripted(responses: readonly IRestResponse[]): { readonly transport: IRestTransport; readonly requests: string[] } {
  const requests: string[] = [];
  return { requests, transport: async (url, media) => { requests.push(`${url}:${media ?? 'json'}`); const response = responses[requests.length - 1]; if (response === undefined) { throw new Error('unexpected request'); } return response; } };
}
/** Successful endpoint representation without invented metadata. */
function ok(body: unknown, link?: string): IRestResponse { return { status: 200, headers: link === undefined ? {} : { link }, body }; }

describe('required PR evidence', () => {
  test.each(['issue', 'inline'])('%s recent and pre-window comment edits remain relevant activity before display filtering', async kind => {
    const earlyScope = { ...scope, start: 100, end: 1000, cutoff: 1000 };
    for (const created of [50, 110]) {
      const comment = { id: 2, body: 'Edited current text', user: { login: 'commenter' }, created_at: new Date(created * 1_000).toISOString(), updated_at: new Date(990 * 1_000).toISOString() };
      const fake = scripted([ok([]), ok(kind === 'issue' ? [comment] : []), ok(kind === 'inline' ? [comment] : [])]);
      await expect(loadDiscussion('acme/widget#101', earlyScope, fake.transport)).resolves.toMatchObject({ complete: true, latestActivity: 990 });
    }
    const futureEdit = { id: 2, body: 'Unconsumed future-edited text', user: { login: 'commenter' }, created_at: new Date(50 * 1_000).toISOString(), updated_at: new Date(1100 * 1_000).toISOString() };
    const future = scripted([ok([]), ok(kind === 'issue' ? [futureEdit] : []), ok(kind === 'inline' ? [futureEdit] : [])]);
    await expect(loadDiscussion('acme/widget#101', earlyScope, future.transport)).resolves.toMatchObject({ latestActivity: 1100, comments: [], inlineComments: [] });
  });
  test('literal reordered and explicitly bound numeric-repository discussion Links remain valid', async () => {
    const next = 'https://api.github.com/repositories/123/pulls/101/reviews?page=2&per_page=100';
    const fake = scripted([ok([], `<${next}>; rel="next"`), ok([{ id: 1, body: 'Review', user: { login: 'reviewer' }, state: 'APPROVED', submitted_at: '2026-01-01T14:00:00Z', commit_id: 'abc' }]), ok([]), ok([])]);
    await expect(loadDiscussion('acme/widget#101', { ...scope, repositoryIds: { 'acme/widget': 123 } }, fake.transport)).resolves.toMatchObject({ reviews: [{ id: 1 }] });
    expect(fake.requests[1]).toBe(`${next}:json`);
    const unbound = scripted([ok([], `<${next}>; rel="next"`)]);
    await expect(loadDiscussion('acme/widget#101', scope, unbound.transport)).rejects.toThrow('coverage');
  });
  test('submitted review timestamp alone leaves historical content/activity basis unverified', async () => {
    const review = { id: 1, body: 'Current editable review text', user: { login: 'reviewer' }, state: 'APPROVED', submitted_at: '2026-01-01T14:00:00Z', commit_id: 'abc' };
    const fake = scripted([ok([review]), ok([]), ok([])]);
    await expect(loadDiscussion('acme/widget#101', scope, fake.transport)).resolves.toMatchObject({ complete: true, contentBasis: { kind: 'unverified' } });
    const controlled = scripted([ok([review]), ok([]), ok([])]);
    await expect(loadDiscussion('acme/widget#101', scope, controlled.transport, { kind: 'controlled-as-of', scenario: 'fixed-a', cutoff: scope.cutoff })).resolves.toMatchObject({ contentBasis: { kind: 'controlled-as-of', scenario: 'fixed-a', cutoff: scope.cutoff } });
    const wrongCutoff = scripted([ok([review]), ok([]), ok([])]);
    await expect(loadDiscussion('acme/widget#101', scope, wrongCutoff.transport, { kind: 'controlled-as-of', scenario: 'fixed-a', cutoff: scope.cutoff + 1 })).rejects.toThrow('coverage');
  });
  test('detail and diff representations preserve qualified identity and cutoff-effective terminal facts', async () => {
    const fake = scripted([ok(pull()), ok('diff --git a/widget b/widget\n+fix')]);
    const detail = await loadPull('acme/widget#101', scope, fake.transport);
    expect(detail).toMatchObject({ id: 'acme/widget#101', title: 'Fix widget', body: 'Explanation', diff: 'diff --git a/widget b/widget\n+fix', merged: true, terminalAt: 1_767_272_400, complete: true });
    expect(fake.requests).toEqual(['https://api.github.com/repos/acme/widget/pulls/101:json', 'https://api.github.com/repos/acme/widget/pulls/101:application/vnd.github.diff']);
  });
  test('future merge/closure cannot establish terminality at an earlier cutoff', async () => {
    const fake = scripted([ok(pull({ merged_at: '2026-01-04T00:00:00Z', closed_at: '2026-01-04T00:00:00Z' })), ok('diff')]);
    await expect(loadPull('acme/widget#101', scope, fake.transport)).resolves.toMatchObject({ merged: false, terminalAt: null });
  });
  test.each([
    ['missing diff', [ok(pull()), { status: 406, headers: {}, body: 'private failure' }]],
    ['wrong pull identity', [ok(pull({ number: 102 }))]],
    ['post-cutoff creation', [ok(pull({ created_at: '2026-01-04T00:00:00Z' }))]],
    ['unsupported historical edit', [ok(pull({ updated_at: '2026-01-04T00:00:00Z' }))]],
  ])('%s never becomes complete detail', async (_label, responses) => {
    await expect(loadPull('acme/widget#101', scope, scripted(responses).transport)).rejects.toThrow('coverage');
  });
  test('all three discussion endpoint families finish independently and filter event times', async () => {
    const review = { id: 1, body: 'Review', user: { login: 'reviewer' }, state: 'APPROVED', submitted_at: '2026-01-01T14:00:00Z', commit_id: 'abc' };
    const comment = { id: 2, body: 'Conversation', user: { login: 'commenter' }, created_at: '2026-01-01T15:00:00Z', updated_at: '2026-01-01T15:00:00Z' };
    const inline = { ...comment, id: 3, body: 'Inline' };
    const late = { ...comment, id: 4, created_at: '2026-01-04T00:00:00Z', updated_at: '2026-01-04T00:00:00Z' };
    const next = 'https://api.github.com/repos/acme/widget/pulls/101/reviews?per_page=100&page=2';
    const fake = scripted([ok([review], `<${next}>; rel="next"`), ok([{ ...review, id: 9, state: 'PENDING', submitted_at: null }]), ok([comment, late]), ok([inline])]);
    const result = await loadDiscussion('acme/widget#101', scope, fake.transport);
    expect(result).toMatchObject({ id: 'acme/widget#101', complete: true, reviews: [{ id: 1, body: 'Review' }], comments: [{ id: 2, body: 'Conversation' }], inlineComments: [{ id: 3, body: 'Inline' }] });
    expect(fake.requests).toHaveLength(4);
  });
  test.each(['missing', 'cycle', 'conflict', 'historical-edit'])('%s required discussion rejects coverage', async mode => {
    const comment = { id: 2, body: 'Conversation', user: { login: 'commenter' }, created_at: '2026-01-01T15:00:00Z', updated_at: mode === 'historical-edit' ? '2026-01-04T15:00:00Z' : '2026-01-01T15:00:00Z' };
    const root = 'https://api.github.com/repos/acme/widget/issues/101/comments?per_page=100&page=1';
    const fake = scripted([ok([]), mode === 'missing' ? { status: 500, headers: {}, body: {} } : ok(mode === 'conflict' ? [comment, { ...comment, body: 'different' }] : [comment], mode === 'cycle' ? `<${root}>; rel="next"` : undefined), ok([])]);
    await expect(loadDiscussion('acme/widget#101', scope, fake.transport)).rejects.toThrow('coverage');
  });
});
