/** Concrete controlled GitHub REST traversal; the harness manifest never reaches this adapter. */
/** Selected authored-PR query, with integer-second half-open creation bounds. @internal */
export interface ISearchQuery { readonly repository: string; readonly login: string; readonly start: number; readonly end: number; readonly perPage: number }
/** Only REST wire status, headers and untrusted JSON reach this adapter. @internal */
export interface IRestResponse { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: unknown }
/** Assembly supplies supervised transport; traversal owns no send authority. @internal */
export type IRestTransport = (url: string, accept?: 'application/vnd.github.diff') => Promise<IRestResponse>;
/** Successful fixed-scenario exhaustion, never an unfinished prefix. @internal */
export interface ICompletedSearch { readonly count: number; readonly ids: readonly string[] }
/** Canonical request encoding also constrains continuation binding. @internal */
export function searchUrl(query: ISearchQuery, page = 1): string {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(query.repository) || !/^[a-zA-Z0-9-]+$/u.test(query.login)
    || !Number.isSafeInteger(query.start) || !Number.isSafeInteger(query.end) || query.end <= query.start
    || !Number.isSafeInteger(query.perPage) || query.perPage < 1 || query.perPage > 100 || !Number.isSafeInteger(page) || page < 1) { return refuse(); }
  const low = new Date(query.start * 1_000).toISOString();
  const high = new Date((query.end - 1) * 1_000).toISOString();
  const parameters = new URLSearchParams({ q: `is:pr repo:${query.repository} author:${query.login} created:${low}..${high}`, sort: 'created', order: 'asc', per_page: String(query.perPage), page: String(page) });
  return `https://api.github.com/search/issues?${parameters.toString()}`;
}
/** Refuse every incomplete population before detail admission. @internal */
export async function discoverAuthored(query: ISearchQuery, transport: IRestTransport): Promise<ICompletedSearch> {
  /** Provider IDs and qualified numbers must form one correspondence throughout every accepted leaf. */
  const byProvider = new Map<number, number>();
  const byNode = new Map<string, number>();
  /** Each recursive leaf has fresh cursor state; parent partial membership is discarded. */
  async function traverse(range: ISearchQuery): Promise<Map<number, string>> {
    const members = new Map<number, string>();
    const pages = new Set<string>();
    let expected: number | undefined;
    let ordinal = 1;
    let requestUrl = searchUrl(range);
    for (;;) {
      const response = await transport(requestUrl);
      const body = response.body;
      if (response.status !== 200 || !isRecord(body) || !Number.isSafeInteger(body.total_count) || typeof body.total_count !== 'number' || body.total_count < 0
        || body.incomplete_results !== false || !Array.isArray(body.items) || body.items.length > range.perPage) { return refuse(); }
      if (expected !== undefined && body.total_count !== expected) { return refuse(); }
      expected = body.total_count;
      if (expected > 1_000) {
        if (ordinal !== 1 || range.end - range.start < 2) { return refuse(); }
        const midpoint = range.start + Math.floor((range.end - range.start) / 2);
        const left = await traverse({ ...range, end: midpoint });
        const right = await traverse({ ...range, start: midpoint });
        for (const [number, evidence] of right) { if (left.has(number)) { return refuse(); } left.set(number, evidence); }
        if (left.size !== expected) { return refuse(); }
        return left;
      }
      const signature = JSON.stringify(body.items);
      if (pages.has(signature)) { return refuse(); }
      pages.add(signature);
      for (const value of body.items) {
        if (!isRecord(value) || typeof value.number !== 'number' || !Number.isSafeInteger(value.number) || value.number < 1
          || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id < 1 || typeof value.node_id !== 'string' || value.node_id.length === 0
          || value.repository_url !== `https://api.github.com/repos/${range.repository}` || !isRecord(value.pull_request)
          || value.pull_request.url !== `https://api.github.com/repos/${range.repository}/pulls/${String(value.number)}`
          || !isRecord(value.user) || value.user.login !== range.login || typeof value.created_at !== 'string') { return refuse(); }
        const created = Date.parse(value.created_at) / 1_000;
        if (!Number.isSafeInteger(created) || created < range.start || created >= range.end) { return refuse(); }
        const evidence = JSON.stringify([value.id, value.node_id, value.created_at, value.user.login]);
        const prior = members.get(value.number);
        if (prior !== undefined && prior !== evidence || byProvider.has(value.id) && byProvider.get(value.id) !== value.number || byNode.has(value.node_id) && byNode.get(value.node_id) !== value.number) { return refuse(); }
        byProvider.set(value.id, value.number);
        byNode.set(value.node_id, value.number);
        members.set(value.number, evidence);
      }
      const next = nextLink(response.headers.link);
      if (next === undefined) { if (members.size !== expected) { return refuse(); } return members; }
      if (ordinal >= 1_000) { return refuse(); }
      requestUrl = continuationUrl(next, searchUrl(range), ordinal + 1);
      ordinal += 1;
    }
  }
  const found = await traverse(query);
  return { count: found.size, ids: [...found.keys()].sort((left, right) => left - right).map(number => `${query.repository}#${String(number)}`) };
}

/** Untrusted JSON must narrow before any provider field can become domain evidence. @internal */
export function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/** Diagnostics expose only a stable classification, never raw private wire content. */
function refuse(): never { throw new Error('incomplete GitHub coverage'); }

/** REST Link continuations must be well formed and unambiguous; absence alone is terminal evidence. @internal */
export function nextLink(header: string | undefined): string | undefined {
  if (header === undefined) { return undefined; }
  let next: string | undefined;
  for (const part of header.split(',')) {
    const match = /^\s*<([^>]+)>;\s*rel="(next|prev|first|last)"\s*$/u.exec(part);
    if (match === null) { return refuse(); }
    if (match[2] === 'next') { if (next !== undefined || match[1] === undefined) { return refuse(); } next = match[1]; }
  }
  return next;
}

/** Validate semantic request binding while preserving equivalent REST query serialization and established repository aliases. @internal */
export function continuationUrl(link: string, root: string, nextPage: number, repository?: { readonly name: string; readonly id: number }): string {
  let candidate: URL;
  let expected: URL;
  try { candidate = new URL(link); expected = new URL(root); } catch { return refuse(); }
  if (candidate.origin !== 'https://api.github.com' || candidate.origin !== expected.origin || candidate.username.length > 0 || candidate.password.length > 0 || candidate.hash.length > 0) { return refuse(); }
  const numericPrefix = repository === undefined ? undefined : `/repositories/${String(repository.id)}/`;
  const path = numericPrefix !== undefined && candidate.pathname.startsWith(numericPrefix) && repository !== undefined
    ? `/repos/${repository.name}/${candidate.pathname.slice(numericPrefix.length)}` : candidate.pathname;
  if (path !== expected.pathname) { return refuse(); }
  const seen = new Set<string>();
  for (const [key, value] of candidate.searchParams) {
    if (seen.has(key)) { return refuse(); }
    seen.add(key);
    if (key === 'page' ? value !== String(nextPage) : expected.searchParams.get(key) !== value) { return refuse(); }
  }
  if (seen.size !== [...expected.searchParams].length || !seen.has('page') || !Number.isSafeInteger(nextPage) || nextPage < 2) { return refuse(); }
  return candidate.toString();
}
