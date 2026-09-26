/** Behavior of application callbacks only; this does not emulate Microdelta's engine. */
import { describe, expect, jest, test } from '@jest/globals';
import { collectAssessments, collectStrict, discoverPRs, isPRFinal, resolvePR, validateJudgment, validateRoster } from './policies.js';
import type { IPRData, IPRPage, IRequestOptions, IWindow } from './domain.js';

const window: IWindow = { start: '2026-01-01T00:00:00Z', end: '2026-04-01T00:00:00Z' };
const pr = { url: 'https://example.test/pr/1', createdAt: '2026-02-01T00:00:00Z' };
const data: IPRData = {
  ...pr, merged: false, title: 'A change', body: 'Description', diff: '+new code', reviews: ['Looks good'],
  version: { details: 'd1', diff: 'f1', reviews: 'r1' },
};
/** A fresh signal and usage sink keep requests observable in every case. */
function options(): IRequestOptions {
  return { signal: new AbortController().signal, onUsage: jest.fn() };
}
/** Collect fixture streams without inventing engine scheduling or persistence. */
async function list<T>(items: AsyncIterable<T>): Promise<readonly T[]> {
  const result: T[] = [];
  for await (const item of items) { result.push(item); }
  return result;
}

describe('non-memoized discovery callbacks', () => {
  test('yields the first page before requesting the second', async () => {
    const read = jest.fn<(cursor: string | undefined) => Promise<IPRPage>>()
      .mockResolvedValueOnce({ items: [pr], next: 'two' })
      .mockResolvedValueOnce({ items: [], next: null });
    const stream = discoverPRs(window, read, options().signal);
    expect(await stream.next()).toEqual({ value: pr, done: false });
    expect(read).toHaveBeenCalledTimes(1);
    expect((await stream.next()).done).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('continues through empty pages, deduplicates URLs, and uses a half-open created-at window', async () => {
    const read = jest.fn<(cursor: string | undefined) => Promise<IPRPage>>()
      .mockResolvedValueOnce({ items: [], next: 'two' })
      .mockResolvedValueOnce({ items: [pr, pr, { ...pr, url: 'end', createdAt: window.end }], next: null });
    expect(await list(discoverPRs(window, read, options().signal))).toEqual([pr]);
    expect(read).toHaveBeenNthCalledWith(2, 'two');
  });

  test('a fresh traversal starts over and finds a PR inserted before shifted pages', async () => {
    const added = { ...pr, url: 'https://example.test/pr/2' };
    const read = jest.fn<(cursor: string | undefined) => Promise<IPRPage>>()
      .mockResolvedValueOnce({ items: [pr], next: null })
      .mockResolvedValueOnce({ items: [added], next: 'two' })
      .mockResolvedValueOnce({ items: [pr], next: null });
    expect(await list(discoverPRs(window, read, options().signal))).toEqual([pr]);
    expect(await list(discoverPRs(window, read, options().signal))).toEqual([added, pr]);
    expect(read.mock.calls.map(call => call[0])).toEqual([undefined, undefined, 'two']);
  });

  test('a page failure propagates instead of manufacturing closure', async () => {
    const read = jest.fn<(cursor: string | undefined) => Promise<IPRPage>>()
      .mockResolvedValueOnce({ items: [pr], next: 'two' })
      .mockRejectedValueOnce(new Error('page unavailable'));
    const stream = discoverPRs(window, read, options().signal);
    await stream.next();
    await expect(stream.next()).rejects.toThrow('page unavailable');
  });

  test('rejects cyclic cursors and invalid time windows', async () => {
    const read = jest.fn<(cursor: string | undefined) => Promise<IPRPage>>()
      .mockResolvedValue({ items: [], next: 'loop' });
    await expect(list(discoverPRs(window, read, options().signal))).rejects.toThrow('Repeated cursor');
    await expect(list(discoverPRs({ start: 'bad', end: window.end }, read, options().signal)))
      .rejects.toThrow('Invalid time window');
  });

  test('cancellation prevents admission of the next page', async () => {
    const controller = new AbortController();
    const read = jest.fn<(cursor: string | undefined) => Promise<IPRPage>>()
      .mockResolvedValue({ items: [pr], next: 'two' });
    const stream = discoverPRs(window, read, controller.signal);
    await stream.next();
    controller.abort();
    await expect(stream.next()).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('finality and explicit source reuse callbacks', () => {
  test('current policy can revoke finality for the same cached snapshot', () => {
    const merged = { merged: true };
    expect(isPRFinal(merged, { acceptMergedAsFinal: true })).toBe(true);
    expect(isPRFinal(merged, { acceptMergedAsFinal: false })).toBe(false);
    expect(isPRFinal({ merged: false }, { acceptMergedAsFinal: true })).toBe(false);
  });

  test('a cold miss fetches a complete snapshot without a reuse path', async () => {
    const inspect = jest.fn<() => Promise<IPRData['version']>>();
    const fetch = jest.fn<() => Promise<IPRData>>().mockResolvedValue(data);
    expect(await resolvePR(pr.url, undefined, { inspect, fetch }, options())).toEqual(data);
    expect(inspect).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('unchanged aggregate evidence returns the exact reuse control result and records validation work', async () => {
    const retained = { retained: true };
    const reuse = jest.fn<(reason: string) => typeof retained>().mockReturnValue(retained);
    const opts = options();
    const inspect = jest.fn(async (_url: string, request: IRequestOptions) => {
      request.onUsage({ metric: 'requests', unit: 'request', amount: 1, resource: 'fixture' });
      return data.version;
    });
    const fetch = jest.fn<() => Promise<IPRData>>();
    expect(await resolvePR(pr.url, { value: data, reuse }, { inspect, fetch }, opts)).toBe(retained);
    expect(reuse).toHaveBeenCalledWith('all evidence validators unchanged');
    expect(fetch).not.toHaveBeenCalled();
    expect(opts.onUsage).toHaveBeenCalledTimes(1);
  });

  test('changed reviews require retrieval even when PR metadata and diff are unchanged', async () => {
    const version = { ...data.version, reviews: 'r2' };
    const fresh = { ...data, version, reviews: ['New review'] };
    const inspect = jest.fn<() => Promise<IPRData['version']>>().mockResolvedValue(version);
    const fetch = jest.fn<() => Promise<IPRData>>().mockResolvedValue(fresh);
    const reuse = jest.fn<(reason: string) => string>();
    expect(await resolvePR(pr.url, { value: data, reuse }, { inspect, fetch }, options())).toEqual(fresh);
    expect(reuse).not.toHaveBeenCalled();
  });

  test('fresh fetch with equal evidence stays a new result rather than implying reuse', async () => {
    const version = { ...data.version, details: 'd2' };
    const fresh = { ...data, version };
    const inspect = jest.fn<() => Promise<IPRData['version']>>().mockResolvedValue(version);
    const fetch = jest.fn<() => Promise<IPRData>>().mockResolvedValue(fresh);
    const reuse = jest.fn<(reason: string) => string>();
    expect(await resolvePR(pr.url, { value: data, reuse }, { inspect, fetch }, options())).toBe(fresh);
    expect(reuse).not.toHaveBeenCalled();
  });

  test('failed validation does not silently accept stale data', async () => {
    const inspect = jest.fn<() => Promise<IPRData['version']>>().mockRejectedValue(new Error('offline'));
    const fetch = jest.fn<() => Promise<IPRData>>();
    const reuse = jest.fn<(reason: string) => string>();
    await expect(resolvePR(pr.url, { value: data, reuse }, { inspect, fetch }, options())).rejects.toThrow('offline');
    expect(reuse).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('mismatched PR data or a raced evidence version is rejected before returning accepted data', async () => {
    const inspect = jest.fn<() => Promise<IPRData['version']>>().mockResolvedValue({ ...data.version, details: 'd2' });
    const fetch = jest.fn<() => Promise<IPRData>>().mockResolvedValue(data);
    await expect(resolvePR(pr.url, { value: data, reuse: () => 'reuse' }, { inspect, fetch }, options()))
      .rejects.toThrow('Evidence changed during retrieval');
    fetch.mockResolvedValue({ ...data, url: 'wrong' });
    await expect(resolvePR(pr.url, undefined, { inspect, fetch }, options())).rejects.toThrow('Wrong PR');
  });
});

describe('strict fold and application validation', () => {
  test('the summary corpus has stable URL order despite assessment completion order', async () => {
    const first = { url: 'a', score: 1, summary: 'First' };
    const second = { url: 'b', score: 2, summary: 'Second' };
    async function* rows() { yield second; yield first; }
    expect(await collectAssessments(rows())).toEqual([first, second]);
  });

  test('fold waits for successful discovery/assessment closure', async () => {
    let release: () => void = () => { throw new Error('Barrier not initialized'); };
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let complete = false;
    async function* rows() { yield 1; await barrier; yield 2; }
    const folded = collectStrict(rows()).then(result => { complete = true; return result; });
    await Promise.resolve();
    expect(complete).toBe(false);
    release();
    expect(await folded).toEqual([1, 2]);
  });

  test('a failed member prevents a complete fold; closed-empty is a valid empty corpus', async () => {
    async function* failed() { yield 1; throw new Error('assessment failed'); }
    async function* empty(): AsyncGenerator<number> { return; }
    await expect(collectStrict(failed())).rejects.toThrow('assessment failed');
    expect(await collectStrict(empty())).toEqual([]);
  });

  test('rejects malformed structured model output', () => {
    expect(validateJudgment({ score: 3, summary: 'Changes validation' })).toEqual({ score: 3, summary: 'Changes validation' });
    for (const value of [null, 'text', { score: 9, summary: 'bad' }, { score: NaN, summary: 'bad' }, { score: 2 }]) {
      expect(() => validateJudgment(value)).toThrow('Invalid judgment');
    }
  });

  test('duplicate employee IDs and missing usernames fail visibly', () => {
    const row = { employeeId: 'e1', name: 'A, Person', githubUsername: 'person' };
    expect(validateRoster([row])).toEqual([row]);
    expect(() => validateRoster([row, row])).toThrow('Duplicate employee');
    expect(() => validateRoster([{ ...row, githubUsername: '' }])).toThrow('Invalid roster row');
  });
});
