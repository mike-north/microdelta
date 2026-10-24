/** One fully collected provider record, distinct from provider traversal identity. */
export interface IRecord { readonly id: number; readonly score: number }
/** Provider cursor data is untrusted; the adapter validates before advancing. */
export interface IPage { readonly records: readonly IRecord[]; readonly next: unknown }
export type IFetch = (cursor: string | null) => Promise<IPage>;

/** Build an explicit complete snapshot; reject partial/ambiguous corpus traversal. */
export async function collect(fetch: IFetch): Promise<readonly IRecord[]> {
  const visited = new Set<string | null>();
  const records = new Map<number, IRecord>();
  let cursor: string | null = null;
  for (;;) {
    if (visited.has(cursor)) { throw new Error('repeating cursor'); }
    visited.add(cursor);
    const page = await fetch(cursor);
    for (const record of page.records) {
      if (records.has(record.id)) { throw new Error('duplicate record'); }
      records.set(record.id, record);
    }
    if (page.next === null) { return [...records.values()].sort((a, b) => a.id - b.id); }
    if (typeof page.next !== 'string' || !/^page:[1-9][0-9]*$/.test(page.next)) { throw new Error('malformed cursor'); }
    cursor = page.next;
  }
}

/** Four stable records intentionally arrive unsorted over two cursor pages. */
export function fixture(): { readonly calls: (string | null)[]; readonly fetch: IFetch } {
  const calls: (string | null)[] = [];
  return { calls, fetch: async cursor => {
    calls.push(cursor);
    if (cursor === null) { return { records: [{ id: 2, score: 2 }, { id: 1, score: 1 }], next: 'page:2' }; }
    if (cursor === 'page:2') { return { records: [{ id: 4, score: 4 }, { id: 3, score: 3 }], next: null }; }
    throw new Error('unknown cursor');
  } };
}
