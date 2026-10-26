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
  test('a literal equivalent Link with reordered unique parameters is followed', async () => {
    const literal = 'https://api.github.com/search/issues?page=2&order=asc&per_page=2&sort=created&q=is%3Apr+repo%3Aacme%2Fwidget+author%3Aada+created%3A2026-01-01T00%3A00%3A00.000Z..2026-01-01T00%3A00%3A01.000Z';
    const fake = script([page(2, [item(101)], `<${literal}>; rel="next"`), page(2, [item(102)])]);
    await expect(discoverAuthored(query, fake.transport)).resolves.toEqual({ count: 2, ids: ['acme/widget#101', 'acme/widget#102'] });
    expect(fake.requests[1]).toBe(literal);
  });
  test.each(['provider-id', 'node-id'])('reverse %s conflicts across pages refuse two counted members', async mode => {
    const first = item(101);
    const second = { ...item(102), ...(mode === 'provider-id' ? { id: first.id } : { node_id: first.node_id }) };
    const fake = script([page(2, [first], `<${searchUrl(query, 2)}>; rel="next"`), page(2, [second])]);
    await expect(discoverAuthored(query, fake.transport)).rejects.toThrow('coverage');
  });
  test('1001 independent distinct PRs exhaust valid cap-split leaves; cross-leaf provider alias refuses closure', async () => {
    const expected = Array.from({ length: 1001 }, (_unused, index) => index + 1);
    const population = expected.map(number => item(number, query.start + (number > 501 ? 1 : 0)));
    const invoke = async (conflict: boolean) => discoverAuthored({ ...query, perPage: 100 }, async url => {
      const request = new URL(url);
      const bounds = /created:([^ ]+)\.\.([^ ]+)/u.exec(request.searchParams.get('q') ?? '');
      const lower = Date.parse(bounds?.[1] ?? '');
      const upper = Date.parse(bounds?.[2] ?? '');
      const filtered = population.filter(value => Date.parse(value.created_at) >= lower && Date.parse(value.created_at) <= upper);
      const ordinal = Number(request.searchParams.get('page'));
      const selected = filtered.slice((ordinal - 1) * 100, ordinal * 100).map(value => conflict && value.number === 1001 ? { ...value, id: population[0]?.id } : value);
      const next = new URL(url); next.searchParams.set('page', String(ordinal + 1));
      return page(filtered.length, filtered.length > 1000 ? [] : selected, filtered.length <= 1000 && ordinal * 100 < filtered.length ? `<${next.toString()}>; rel="next"` : undefined);
    });
    await expect(invoke(false)).resolves.toEqual({ count: 1001, ids: expected.map(number => `acme/widget#${String(number)}`) });
    await expect(invoke(true)).rejects.toThrow('coverage');
  });
  test('duplicate semantic query parameters refuse continuation', async () => {
    const next = `${searchUrl(query, 2)}&page=2`;
    await expect(discoverAuthored(query, script([page(2, [item(101)], `<${next}>; rel="next"`)]).transport)).rejects.toThrow('coverage');
  });
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
