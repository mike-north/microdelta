/** Independent REST fixtures challenge controlled closure without exposing a complete-set oracle. */
import { describe, expect, test } from '@jest/globals';
import { discoverAuthored, searchUrl } from '../src/controlled/github.js';
import type { IRestResponse, IRestTransport, ISearchQuery } from '../src/controlled/github.js';

/** Two-second creation scope permits an independently asserted cap split. */
const query: ISearchQuery = { repository: 'acme/widget', login: 'ada', start: 1_767_225_600, end: 1_767_225_602, perPage: 2 };
/** Only documented issue-search fields appear on the wire. */
function item(number: number, second = query.start) {
  return { id: 10_000 + number, node_id: `issue-${String(number)}`, number, repository_url: 'https://api.github.com/repos/acme/widget', created_at: new Date(second * 1_000).toISOString(), user: { login: 'ada' }, pull_request: { url: `https://api.github.com/repos/acme/widget/pulls/${String(number)}` } };
}
/** The harness chooses responses by request; the adapter receives no manifest. */
function script(responses: readonly IRestResponse[]): { readonly transport: IRestTransport; readonly requests: string[] } {
  const requests: string[] = [];
  return { requests, transport: async url => { requests.push(url); const result = responses[requests.length - 1]; if (result === undefined) { throw new Error('unexpected request'); } return result; } };
}
/** A terminal response uses absence of next Link, not page length. */
function page(total: number, items: readonly unknown[], link?: string): IRestResponse {
  return { status: 200, headers: link === undefined ? {} : { link }, body: { total_count: total, incomplete_results: false, items } };
}

describe('fixed backing dataset REST-shaped controlled search', () => {
  test('returns qualified IDs only after every page terminates; an empty continuing page stays open', async () => {
    const next = searchUrl(query, 2);
    const fake = script([page(2, [], `<${next}>; rel="next"`), page(2, [item(102), item(101)])]);
    await expect(discoverAuthored(query, fake.transport)).resolves.toEqual({ count: 2, ids: ['acme/widget#101', 'acme/widget#102'] });
    expect(fake.requests).toEqual([searchUrl(query), next]);
  });
  test('terminal empty closes and identical overlap coalesces', async () => {
    await expect(discoverAuthored(query, script([page(0, [])]).transport)).resolves.toEqual({ count: 0, ids: [] });
    const fake = script([page(3, [item(101), item(102)], `<${searchUrl(query, 2)}>; rel="next"`), page(3, [item(102), item(103)])]);
    await expect(discoverAuthored(query, fake.transport)).resolves.toEqual({ count: 3, ids: ['acme/widget#101', 'acme/widget#102', 'acme/widget#103'] });
  });
  test.each([
    ['incomplete', { status: 200, headers: {}, body: { total_count: 0, incomplete_results: true, items: [] } }],
    ['malformed envelope', { status: 200, headers: {}, body: { total_count: 0, items: [] } }],
    ['truncated count', page(2, [item(101)])],
    ['wrong repository', page(1, [{ number: 101, repository_url: 'https://api.github.com/repos/other/repo' }])],
    ['post-cutoff creation', page(1, [item(101, query.end)])],
    ['failed response', { status: 403, headers: {}, body: { message: 'synthetic private body' } }],
    ['author-limited response', { status: 422, headers: {}, body: {} }],
  ])('%s refuses closure', async (_label, response) => {
    await expect(discoverAuthored(query, script([response]).transport)).rejects.toThrow('coverage');
  });
  test.each(['repeat', 'backward', 'cycle', 'query', 'foreign', 'count', 'conflict', 'repeated-page'])('%s continuation refuses closure', async mode => {
    const next = mode === 'repeat' || mode === 'backward' ? searchUrl(query) : mode === 'query' ? searchUrl({ ...query, login: 'grace' }, 2) : mode === 'foreign' ? 'https://private.invalid/secret' : searchUrl(query, 2);
    const replacement = { ...item(101), id: 999_999 };
    const fake = script([page(2, [item(101)], `<${next}>; rel="next"`), page(mode === 'count' ? 3 : 2, [mode === 'conflict' ? replacement : mode === 'repeated-page' ? item(101) : item(102)], mode === 'cycle' ? `<${searchUrl(query)}>; rel="next"` : undefined)]);
    await expect(discoverAuthored(query, fake.transport)).rejects.toThrow('coverage');
  });
  test('a capped one-second leaf cannot certify exhaustion', async () => {
    await expect(discoverAuthored({ ...query, end: query.start + 1 }, script([page(1001, [])]).transport)).rejects.toThrow('coverage');
  });
  test('a fresh traversal starts at root after failure and never unions stale progress', async () => {
    const first = script([page(2, [item(101)], `<${searchUrl(query, 2)}>; rel="next"`), { status: 500, headers: {}, body: {} }]);
    await expect(discoverAuthored(query, first.transport)).rejects.toThrow('coverage');
    const second = script([page(1, [item(103)])]);
    await expect(discoverAuthored(query, second.transport)).resolves.toEqual({ count: 1, ids: ['acme/widget#103'] });
    expect(second.requests).toEqual([searchUrl(query)]);
  });
  test('matching totals cannot detect a same-count live mutation', async () => {
    const fake = script([page(4, [item(101), item(102)], `<${searchUrl(query, 2)}>; rel="next"`), page(4, [item(104), item(105)])]);
    const observed = await discoverAuthored(query, fake.transport);
    expect(observed.ids).toEqual(['acme/widget#101', 'acme/widget#102', 'acme/widget#104', 'acme/widget#105']);
    // Hidden current live set is [102,103,104,105]; no wire field proves that swap.
    expect(observed.ids).not.toContain('acme/widget#103');
  });
});
