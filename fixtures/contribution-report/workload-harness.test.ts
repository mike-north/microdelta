/** Small focused acceptance assertions define REST-shaped workload behavior before its harness. */
import { describe, expect, test } from '@jest/globals';
import { searchUrl } from '../../examples/contribution-report/src/controlled/github.js';
import { discoverAuthored } from '../../examples/contribution-report/src/controlled/github.js';
import { createWorkloadHarness, maxRssBytesFromKibibytes, summarizeRetainedSubjectRows } from './workload-harness.js';
import { workloadInputs, workloadPerson, workloadPull } from './workload-fixture.js';

const send = { signal: { aborted: false, onAbort: () => () => undefined }, operation: 'workload-test-operation', requestAttempt: 'workload-test-attempt', idempotencyKey: undefined };

describe('controlled workload REST harness', () => {
  test('access context is a bounded opaque identifier accepted by retry-source policy', () => {
    expect(() => createWorkloadHarness('workload:/var/folders/r4/j5y28vpj6258k4_0kn5f33s00000gn/T/issue260-controlled-workload-rqNBcG')).toThrow('bounded non-secret identifier');
    expect(createWorkloadHarness('workload:issue-260').services.connection).toBe('workload:issue-260');
  });

  test('converts Node maxRSS kibibytes into byte measurements exactly', () => {
    expect(maxRssBytesFromKibibytes(294_928)).toBe(302_006_272);
  });

  test('keeps retained subject counts, result records and acceptances separate by subject kind', () => {
    expect(summarizeRetainedSubjectRows([
      { subject: 'discussion:acme/widget#1', results: 2, acceptances: 2 },
      { subject: 'detail:acme/widget#1', results: 1, acceptances: 1 },
      { subject: 'assessment:acme/widget#1', results: 1, acceptances: 1 },
      { subject: 'report', results: 1, acceptances: 1 },
    ])).toEqual({
      assessment: { subjects: 1, results: 1, acceptances: 1 },
      detail: { subjects: 1, results: 1, acceptances: 1 },
      discussion: { subjects: 1, results: 2, acceptances: 2 },
      report: { subjects: 1, results: 1, acceptances: 1 },
    });
  });

  test('search returns a real paginated corpus page while retaining the complete set only out of band', async () => {
    const harness = createWorkloadHarness('workload-harness-test');
    const person = workloadPerson(0);
    const url = searchUrl({ repository: 'acme/widget', login: person.login, start: workloadInputs.scope.start, end: workloadInputs.scope.end, perPage: 100 });
    const response = await harness.services.github(url, undefined, send);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total_count: 250, incomplete_results: false, items: expect.arrayContaining([expect.objectContaining({ number: 1, repository_url: 'https://api.github.com/repos/acme/widget' })]) });
    expect(response.headers.link).toContain('rel="next"');
    expect(harness.expectedPulls.size).toBe(150_000);
    expect(harness.observedPulls.size).toBe(100);
  });

  test('one prolific 2,250-PR author traverses the cap split and every actual search leaf', async () => {
    const harness = createWorkloadHarness('workload-prolific-test');
    const person = workloadPerson(299);
    const result = await discoverAuthored({ repository: 'acme/widget', login: person.login, start: workloadInputs.scope.start,
      end: workloadInputs.scope.end, perPage: 100 }, url => harness.services.github(url, undefined, send));
    const expected = new Set(Array.from({ length: person.pullRequests }, (_, ordinal) => `acme/widget#${String(workloadPull(person, ordinal).number)}`));
    expect(result.count).toBe(2_250);
    expect(new Set(result.ids)).toEqual(expected);
    expect(harness.observedPulls).toEqual(expected);
    expect(harness.stats().searchRanges).toEqual({ rangeRequests: 7, splitRanges: 3, terminalRanges: 4, pageRequestsOnTerminalRanges: 24 });
    expect(harness.stats().routes['search-page']?.sends).toBe(27);
  });

  test('all four evidence routes expose distinct records and count hydrated payloads at dispatch', async () => {
    const harness = createWorkloadHarness('workload-routes-test');
    const base = 'https://api.github.com/repos/acme/widget';
    const detail = await harness.services.github(`${base}/pulls/1`, undefined, send);
    const diff = await harness.services.github(`${base}/pulls/1`, 'application/vnd.github.diff', send);
    const reviews = await harness.services.github(`${base}/pulls/1/reviews`, undefined, send);
    const comments = await harness.services.github(`${base}/issues/1/comments`, undefined, send);
    const inline = await harness.services.github(`${base}/pulls/1/comments`, undefined, send);
    expect(detail.body).toMatchObject({ number: 1, title: 'Contribution 1 by engineer-001', state: 'closed' });
    expect(typeof diff.body).toBe('string');
    expect(reviews.body).toHaveLength(1);
    expect(comments.body).toHaveLength(2);
    expect(inline.body).toHaveLength(1);
    expect(harness.stats()).toMatchObject({ loadedReviewEntries: 1, loadedCommentEntries: 2, loadedInlineEntries: 1 });
    expect(harness.stats().hydratedPayloadBytes).toBeGreaterThan(0);
    expect(harness.stats().routes['pull-diff']?.responseBytes).toBe(Buffer.byteLength(String(diff.body), 'utf8'));
    expect(harness.stats().routes['pull-detail']?.responseBytes).toBe(Buffer.byteLength(JSON.stringify(detail.body), 'utf8'));
  });
});
