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
  test('zero selected delay uses retry-now rather than an invalid zero-duration retry-after', async () => {
    const policy = githubRetryPolicy('fixture-a', { backoffMilliseconds: 0, maximumDelayMilliseconds: 0, maximumTotalWaitMilliseconds: 0 }, () => 1000);
    await expect(policy.decide(input({ knownNotBefore: 1000 }))).resolves.toEqual({ kind: 'retry-now' });
  });
  test.each(['1.5', '999999999999999999999999', 'garbage'])('malformed Retry-After%s cannot make a non-rate403 retryable', retryAfter => {
    expect(normalizeGithub({ status: 403, headers: { 'retry-after': retryAfter }, body: {} }, 1000)).toMatchObject({ kind: 'failed', transient: false });
  });
  test.each(['Fri, 31 Feb 2026 00:00:00 GMT', 'Fri, 01 Jan 1970 00:00:04 GMT', 'Thu, 01 Jan 1970 24:00:00 GMT', 'Thursday, 31-Feb-26 00:00:00 GMT', 'Thu Feb 31 00:00:00 2026'])('invalid HTTP date components %s cannot establish a rate403', retryAfter => {
    expect(normalizeGithub({ status: 403, headers: { 'retry-after': retryAfter }, body: {} }, 1000)).toMatchObject({ kind: 'failed', transient: false });
  });
  test.each(['Thursday, 01-Jan-70 00:00:04 GMT', 'Thu Jan  1 00:00:04 1970'])('supported obsolete HTTP date %s preserves its valid floor', retryAfter => {
    expect(normalizeGithub({ status: 403, headers: { 'retry-after': retryAfter }, body: {} }, 1000)).toMatchObject({ kind: 'rate-limited', retryAt: 4000 });
  });
  test.each([
    [{ 'retry-after': '9007199254740992' }, 1000],
    [{ 'retry-after': '9007199254741' }, 1000],
    [{ 'retry-after': '1' }, Number.MAX_SAFE_INTEGER - 500],
    [{ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9007199254740992' }, 1000],
  ])('unsafe seconds, millisecond conversion or epoch addition cannot establish rate403', (headers, now) => {
    expect(normalizeGithub({ status: 403, headers, body: {} }, now)).toMatchObject({ kind: 'failed', transient: false });
  });
  test('invalid timing preserves429 rate status and independently valid reset evidence for403', () => {
    expect(normalizeGithub({ status: 429, headers: { 'retry-after': '1.5' }, body: {} }, 1000)).toMatchObject({ kind: 'rate-limited', retryAt: 1000 });
    expect(normalizeGithub({ status: 403, headers: { 'retry-after': '1.5', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '5' }, body: {} }, 1000)).toMatchObject({ kind: 'rate-limited', retryAt: 5000 });
  });
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
