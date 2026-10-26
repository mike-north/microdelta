/** CR-2 normalization/budget expectations are provider-specific; request attempts remain supervised runtime authority. */
import { describe, expect, test } from '@jest/globals';
import type { IRetryDecisionInput } from 'microdelta';
import { normalizeGithub } from '../src/controlled/application.js';
import { githubRetryPolicy } from '../src/controlled/github-retry.js';

/** The selected callback receives only normalized bounded facts and recorded attempt history. */
function input(overrides: Partial<IRetryDecisionInput> = {}): IRetryDecisionInput {
  return { context: { analysis: 'controlled-contribution-report', environment: 'production', runId: 'retry-test' }, source: { source: 'controlled-github-rest', service: 'controlled', connection: 'fixture-a' }, operation: 'operation-a', requestAttempt: 'attempt-a', outcome: { kind: 'rate-limited' }, facts: { httpStatus: 429 }, history: { sentAttempts: 1, prior: [], omittedPriorAttempts: 0 }, signal: { aborted: false, onAbort: () => () => undefined }, ...overrides };
}

describe('GitHub retry facts and explicit application budgets', () => {
  test.each([
    [429, { 'retry-after': '2' }, 3000],
    [403, { 'retry-after': 'Thu, 01 Jan 1970 00:00:04 GMT' }, 4000],
    [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '5' }, 5000],
    [429, { 'retry-after': '2', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '5' }, 5000],
  ])('status%s timing takes maximum authoritative header floor', (status, headers, floor) => {
    expect(normalizeGithub({ status, headers, body: { secret: 'PRIVATE_BODY' } }, 1000)).toEqual({ kind: 'rate-limited', retryAt: floor, retryFacts: { httpStatus: status, providerCode: 'rate-refusal' } });
  });
  test.each([401, 403, 404, 422])('status%s without rate evidence is never a rate retry', status => {
    expect(normalizeGithub({ status, headers: { authorization: 'PRIVATE_TOKEN', 'retry-after': 'not a time' }, body: 'PRIVATE_BODY' }, 1000)).toEqual({ kind: 'failed', transient: false, retryFacts: { httpStatus: status, providerCode: status === 401 || status === 403 ? 'access-refusal' : 'http-failure' } });
  });
  test('selected local backoff and independent provider floor are both honored without shortening either', async () => {
    const policy = githubRetryPolicy('fixture-a', { backoffMilliseconds: 1500, maximumDelayMilliseconds: 5000, maximumTotalWaitMilliseconds: 10_000 }, () => 1000);
    await expect(policy.decide(input({ knownNotBefore: 2000 }))).resolves.toEqual({ kind: 'retry-after', delayMilliseconds: 1500 });
    await expect(policy.decide(input({ knownNotBefore: 4000 }))).resolves.toEqual({ kind: 'retry-after', delayMilliseconds: 3000 });
  });
  test('delay and cumulative wait boundaries accept equality and reject excess or unavailable truncated history', async () => {
    const policy = githubRetryPolicy('fixture-a', { backoffMilliseconds: 100, maximumDelayMilliseconds: 1000, maximumTotalWaitMilliseconds: 1500 }, () => 1000);
    const history = { sentAttempts: 2, prior: [{ requestAttempt: 'first', status: 'rate-limited', usage: 'none', decision: { kind: 'retry-after', delayMilliseconds: 500 } }], omittedPriorAttempts: 0 } as const;
    await expect(policy.decide(input({ history, knownNotBefore: 2000 }))).resolves.toEqual({ kind: 'retry-after', delayMilliseconds: 1000 });
    await expect(policy.decide(input({ history, knownNotBefore: 2001 }))).resolves.toEqual({ kind: 'stop' });
    const exhausted = { ...history, prior: [{ ...history.prior[0], decision: { kind: 'retry-after', delayMilliseconds: 1401 } }] } as const;
    await expect(policy.decide(input({ history: exhausted }))).resolves.toEqual({ kind: 'stop' });
    await expect(policy.decide(input({ history: { ...history, omittedPriorAttempts: 1 } }))).resolves.toEqual({ kind: 'stop' });
  });
  test('authentication, non-rate permanent failure and ambiguous transport are not reclassified as rate retry', async () => {
    const policy = githubRetryPolicy('fixture-a', { backoffMilliseconds: 100, maximumDelayMilliseconds: 1000, maximumTotalWaitMilliseconds: 2000 }, () => 1000);
    await expect(policy.decide(input({ outcome: { kind: 'failed', transient: false }, facts: { httpStatus: 401 } }))).resolves.toEqual({ kind: 'stop' });
    await expect(policy.decide(input({ outcome: { kind: 'failed', transient: false }, facts: { httpStatus: 403 } }))).resolves.toEqual({ kind: 'stop' });
    await expect(policy.decide(input({ outcome: { kind: 'unknown' }, facts: {} }))).resolves.toEqual({ kind: 'stop' });
    await expect(policy.decide(input({ outcome: { kind: 'failed', transient: true }, facts: { httpStatus: 503 } }))).resolves.toEqual({ kind: 'retry-after', delayMilliseconds: 100 });
  });
});
