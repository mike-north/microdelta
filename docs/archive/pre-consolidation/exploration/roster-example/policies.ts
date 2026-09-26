/** Executable application policies used by the compile-checked authoring example. @internal */
import type { IAssessment, IEvidenceVersion, IEmployee, IJudgment, IPRData, IPRPage, IPRReader, IPRReference, IRequestOptions, ISourcePolicy, IWindow } from './domain.js';

/** Prior-result access is generic in the framework's opaque reuse control type. @internal */
export interface IPrior<Reuse> { readonly value: IPRData; readonly reuse: (reason: string) => Reuse }

/**
 * Enumerate anew on every invocation. Keep deduplication local to this traversal;
 * an item's stable URL permits reuse of its later work, not reuse of page position.
 * @internal
 */
export async function* discoverPRs(
  window: IWindow,
  read: (cursor: string | undefined) => Promise<IPRPage>,
  signal: AbortSignal,
): AsyncGenerator<IPRReference> {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error('Invalid time window');
  }
  const seenURLs = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    signal.throwIfAborted();
    const page = await read(cursor);
    for (const pr of page.items) {
      signal.throwIfAborted();
      const createdAt = Date.parse(pr.createdAt);
      if (!pr.url.trim() || !Number.isFinite(createdAt)) { throw new Error('Invalid PR reference'); }
      // The example's explicit scope is creation time, not last update or merge time.
      if (createdAt < start || createdAt >= end || seenURLs.has(pr.url)) { continue; }
      seenURLs.add(pr.url);
      yield pr;
    }
    signal.throwIfAborted();
    if (page.next === null) { return; }
    if (cursors.has(page.next)) { throw new Error('Repeated cursor'); }
    cursors.add(page.next);
    cursor = page.next;
  }
}

/** Reevaluate this current function; neither its answer nor a finality flag is stored. @internal */
export function isPRFinal(snapshot: Pick<IPRData, 'merged'>, policy: ISourcePolicy): boolean {
  return policy.acceptMergedAsFinal && snapshot.merged;
}

/** The adapter contract covers metadata, diff comparison, AND reviews independently. */
function sameVersion(left: IEvidenceVersion, right: IEvidenceVersion): boolean {
  return left.details === right.details && left.diff === right.diff && left.reviews === right.reviews;
}

/**
 * Perform progressively more expensive source work. The prior reuse function is
 * a framework control outcome: it preserves prior provenance, unlike returning
 * the old payload as newly fetched data. Errors propagate rather than imply reuse.
 * @internal
 */
export async function resolvePR<Reuse>(
  url: string,
  prior: IPrior<Reuse> | undefined,
  reader: IPRReader,
  options: IRequestOptions,
): Promise<IPRData | Reuse> {
  options.signal.throwIfAborted();
  let expected: IEvidenceVersion | undefined;
  if (prior !== undefined) {
    if (prior.value.url !== url) { throw new Error('Wrong PR in prior result'); }
    expected = await reader.inspect(url, options);
    options.signal.throwIfAborted();
    if (sameVersion(expected, prior.value.version)) {
      return prior.reuse('all evidence validators unchanged');
    }
  }
  // A cold miss goes directly to full retrieval. The adapter must produce a
  // coherent snapshot and reject/retry a race against the expected version.
  const fresh = await reader.fetch(url, options, expected);
  options.signal.throwIfAborted();
  if (fresh.url !== url) { throw new Error('Wrong PR in fetched result'); }
  if (expected !== undefined && !sameVersion(expected, fresh.version)) {
    throw new Error('Evidence changed during retrieval');
  }
  return fresh;
}

/** Consume to successful closure; any stream/member error prevents a complete result. @internal */
export async function collectStrict<T>(items: AsyncIterable<T>): Promise<readonly T[]> {
  const values: T[] = [];
  for await (const item of items) { values.push(item); }
  return values;
}

/** Stable corpus order prevents network completion order from changing summary inputs. @internal */
export async function collectAssessments(items: AsyncIterable<IAssessment>): Promise<readonly IAssessment[]> {
  return [...await collectStrict(items)].sort((left, right) => left.url < right.url ? -1 : left.url > right.url ? 1 : 0);
}

/** Validate provider output before it can become a successful memoized value. @internal */
export function validateJudgment(value: unknown): IJudgment {
  if (typeof value !== 'object' || value === null || !('score' in value) || !('summary' in value)
    || typeof value.score !== 'number' || !Number.isInteger(value.score) || value.score < 1 || value.score > 5
    || typeof value.summary !== 'string' || value.summary.trim().length === 0) {
    throw new Error('Invalid judgment: expected score 1–5 and a nonempty summary');
  }
  return { score: value.score, summary: value.summary };
}

/** A real CSV adapter handles syntax/columns first; reject ambiguous row identity here. @internal */
export function validateRoster(rows: readonly IEmployee[]): readonly IEmployee[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.employeeId.trim() || !row.name.trim() || !row.githubUsername.trim()) {
      throw new Error('Invalid roster row');
    }
    if (ids.has(row.employeeId)) { throw new Error(`Duplicate employee: ${row.employeeId}`); }
    ids.add(row.employeeId);
  }
  return rows;
}
