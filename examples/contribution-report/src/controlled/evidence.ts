/** Concrete required PR representations and three independent discussion traversals. */
import { continuationUrl, isRecord, nextLink } from './github.js';
import type { IRestTransport } from './github.js';

/** Provider scope accepts indexed tracked arrays without forcing a whole-value materialization. @internal */
export interface IProviderScope { readonly repositories: { readonly length: number; readonly [index: number]: string }; readonly start: number; readonly end: number; readonly cutoff: number; readonly repositoryIds?: Readonly<Record<string, number>> }
/** This explicit harness guarantee is outside REST; absence never establishes historical review content or inactivity. @internal */
export type IContentBasis = { readonly kind: 'unverified' } | { readonly kind: 'controlled-as-of'; readonly scenario: string; readonly cutoff: number };

/** Current PR content and timestamp-qualified lifecycle facts, separately retained by stable ID. @internal */
export interface IPullDetail { readonly id: string; readonly title: string; readonly body: string; readonly diff: string; readonly merged: boolean; readonly terminalAt: number | null; readonly latestActivity: number; readonly complete: boolean; readonly labels: readonly string[] }
/** Submitted activity retains its provider identity and consumed text, never a page identity. @internal */
export interface IDiscussionEntry { readonly id: number; readonly body: string; readonly author: string; readonly at: number }
/** Each endpoint must terminate before this required input is complete. @internal */
export interface IDiscussion { readonly id: string; readonly reviews: readonly IDiscussionEntry[]; readonly comments: readonly IDiscussionEntry[]; readonly inlineComments: readonly IDiscussionEntry[]; readonly latestActivity: number; readonly complete: boolean; readonly contentBasis: IContentBasis }
/** Fetch the JSON and diff representations needed by the assessment. @internal */
export async function loadPull(id: string, scope: IProviderScope, transport: IRestTransport): Promise<IPullDetail> {
  const { start, end, cutoff } = captureBounds(scope);
  const { repository, number, url } = pullAddress(id, scope);
  const response = await transport(url);
  const value = response.body;
  if (response.status !== 200 || !isRecord(value) || value.number !== number || !isRecord(value.base) || !isRecord(value.base.repo) || value.base.repo.full_name !== repository
    || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || typeof value.title !== 'string' || (typeof value.body !== 'string' && value.body !== null)
    || (value.state !== 'closed' && value.state !== 'open') || !Array.isArray(value.labels)) { return incomplete(); }
  const created = timestamp(value.created_at);
  const updated = timestamp(value.updated_at);
  if (created < start || created >= Math.min(end, cutoff) || updated > cutoff) { return incomplete(); }
  const merged = value.merged_at === null ? null : timestamp(value.merged_at);
  const closed = value.closed_at === null ? null : timestamp(value.closed_at);
  const labels = value.labels.map((label: unknown) => { if (!isRecord(label) || typeof label.name !== 'string') { return incomplete(); } return label.name; });
  const title = value.title;
  const body = value.body ?? '';
  const state = value.state;
  const diff = await transport(url, 'application/vnd.github.diff');
  if (diff.status !== 200 || typeof diff.body !== 'string') { return incomplete(); }
  const terminalAt = state === 'closed' && closed !== null && closed <= cutoff ? closed : null;
  return { id, title, body, diff: diff.body, merged: merged !== null && merged <= cutoff, terminalAt,
    latestActivity: Math.max(created, updated, closed ?? 0, merged ?? 0), complete: true, labels };
}
/** Finish reviews, conversation comments and inline comments separately. @internal */
export async function loadDiscussion(id: string, scope: IProviderScope, transport: IRestTransport, basis: IContentBasis = { kind: 'unverified' }): Promise<IDiscussion> {
  const { start, end, cutoff } = captureBounds(scope);
  // Capture once before transport can run caller code; readonly annotations do not freeze caller-owned objects.
  const contentBasis: IContentBasis = basis.kind === 'controlled-as-of'
    ? Object.freeze({ kind: 'controlled-as-of', scenario: basis.scenario, cutoff: basis.cutoff }) : Object.freeze({ kind: 'unverified' });
  if (contentBasis.kind === 'controlled-as-of' && (contentBasis.cutoff !== cutoff || !Number.isSafeInteger(contentBasis.cutoff) || contentBasis.cutoff < 0
    || contentBasis.scenario.length > 128 || !/^[a-zA-Z0-9_.:-]+$/u.test(contentBasis.scenario))) { return incomplete(); }
  const { repository, number, url } = pullAddress(id, scope);
  // Only this repository's configured numeric alias is consumed; never materialize the whole tracked mapping.
  const repositoryId = scope.repositoryIds?.[repository];
  if (repositoryId !== undefined && (!Number.isSafeInteger(repositoryId) || repositoryId < 1)) { return incomplete(); }
  let latestActivity = start;
  /** Every endpoint traverses its own Link chain; search closure conveys no list coverage. */
  async function entries(endpoint: string, review: boolean): Promise<readonly IDiscussionEntry[]> {
    let ordinal = 1;
    const root = `${endpoint}?per_page=100&page=1`;
    let requestUrl = root;
    const pages = new Set<string>();
    const records = new Map<number, string>();
    const included: IDiscussionEntry[] = [];
    for (;;) {
      const response = await transport(requestUrl);
      if (response.status !== 200 || !Array.isArray(response.body) || response.body.length > 100) { return incomplete(); }
      const signature = JSON.stringify(response.body);
      if (pages.has(signature)) { return incomplete(); }
      pages.add(signature);
      for (const value of response.body) {
        if (!isRecord(value) || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id < 1 || typeof value.body !== 'string'
          || !isRecord(value.user) || typeof value.user.login !== 'string') { return incomplete(); }
        const fingerprint = JSON.stringify(value);
        const prior = records.get(value.id);
        if (prior !== undefined) { if (prior !== fingerprint) { return incomplete(); } continue; }
        records.set(value.id, fingerprint);
        if (review && value.state === 'PENDING' && value.submitted_at === null) { continue; }
        if (review && (typeof value.state !== 'string' || !['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'].includes(value.state) || typeof value.commit_id !== 'string')) { return incomplete(); }
        const at = timestamp(review ? value.submitted_at : value.created_at);
        const updated = review ? at : timestamp(value.updated_at);
        if (updated < at) { return incomplete(); }
        // Relevant activity and displayed creation-window membership are different questions.
        latestActivity = Math.max(latestActivity, at, updated);
        if (at >= Math.min(end, cutoff) || at < start) { continue; }
        // Current edited bodies do not reconstruct arbitrary historical text.
        if (!review && updated > cutoff) { return incomplete(); }
        included.push({ id: value.id, body: value.body, author: value.user.login, at });
      }
      const next = nextLink(response.headers.link);
      if (next === undefined) { return included.sort((left, right) => left.id - right.id); }
      requestUrl = continuationUrl(next, root, ordinal + 1, repositoryId === undefined ? undefined : { name: repository, id: repositoryId });
      ordinal += 1;
    }
  }
  const reviews = await entries(`${url}/reviews`, true);
  const comments = await entries(`https://api.github.com/repos/${repository}/issues/${String(number)}/comments`, false);
  const inlineComments = await entries(`${url}/comments`, false);
  return { id, reviews, comments, inlineComments, latestActivity, complete: true, contentBasis };
}

/** Scalar report bounds form one operation binding; transport cannot relabel it by mutating caller-owned input. */
function captureBounds(scope: IProviderScope): { readonly start: number; readonly end: number; readonly cutoff: number } {
  const start = scope.start;
  const end = scope.end;
  const cutoff = scope.cutoff;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(cutoff) || start < 0 || end <= start || cutoff <= start) { return incomplete(); }
  return { start, end, cutoff };
}

/** Qualified IDs select only explicitly configured repositories, never an arbitrary response URL. */
function pullAddress(id: string, scope: IProviderScope): { readonly repository: string; readonly number: number; readonly url: string } {
  const match = /^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)#([1-9][0-9]*)$/u.exec(id);
  const repository = match?.[1];
  const number = Number(match?.[2]);
  let allowed = false;
  for (let index = 0; index < scope.repositories.length; index += 1) { if (scope.repositories[index] === repository) { allowed = true; } }
  if (repository === undefined || !allowed || !Number.isSafeInteger(number)) { return incomplete(); }
  return { repository, number, url: `https://api.github.com/repos/${repository}/pulls/${String(number)}` };
}

/** Second precision is explicit throughout report bounds and provider event filtering. */
function timestamp(value: unknown): number {
  const seconds = typeof value === 'string' ? Date.parse(value) / 1_000 : NaN;
  if (!Number.isSafeInteger(seconds) || seconds < 0) { return incomplete(); }
  return seconds;
}

/** Private provider content never appears in this diagnostic classification. */
function incomplete(): never { throw new Error('incomplete GitHub coverage'); }
