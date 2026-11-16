/** Tests-first precise refusals/terminal evidence and byte/count caps; no acceptance relaxation. */
import { expect, test } from '@jest/globals';
import { classifyRssProbe, normalizePsCompletion, retainRssObservation } from '../src/tuple-rss.js';
import type { IPsCompletion, IRssTrace } from '../src/tuple-rss.js';

/** Every raw fixture is independent of the implementation's classifier/formatter. */
const normal: IPsCompletion = { status: 0, signal: null, code: null, stdout: '17 11 R 123\n', stderr: '' };
test('successful and terminal probes retain exact raw and parsed witnesses', () => {
  const observed = classifyRssProbe(17, 11, normal, () => 'present');
  expect(observed.reading).toBe(123 * 1024);
  expect(observed.observation).toMatchObject({ ps: { status: 0, stdout: '17 11 R 123\n', stdoutBytes: 12, stdoutTruncated: false, stderr: '' }, parsed: { pid: 17, parentPid: 11, state: 'R', rssKiB: 123 }, kernelLookup: 'not-attempted', classification: 'observed' });
  const zombie = classifyRssProbe(17, 11, { ...normal, stdout: '17 11 Z 0\n' }, () => 'present');
  expect(zombie.reading).toBe('zombie'); expect(zombie.observation).toMatchObject({ parsed: { state: 'Z', rssKiB: 0 }, classification: 'zombie' });
  const absent = classifyRssProbe(17, 11, { ...normal, status: 1, stdout: '' }, () => 'ESRCH');
  expect(absent.reading).toBe('not-running'); expect(absent.observation).toMatchObject({ ps: { status: 1, stdout: '', stderr: '' }, kernelLookup: 'ESRCH', classification: 'not-running' });
});
test('every rejected completion retains bounded raw fields and a precise refusal reason', () => {
  for (const [raw, lookup, reason] of [
    [{ ...normal, status: null, signal: 'SIGTERM', code: 'EPERM', stdout: '', stderr: 'denied\n' }, 'error', 'ps-failed'],
    [{ ...normal, stdout: 'not a process\n' }, 'present', 'malformed-ps-output'],
    [{ ...normal, stdout: '18 11 R 1\n' }, 'present', 'pid-mismatch'],
    [{ ...normal, stdout: '17 12 R 1\n' }, 'present', 'parent-pid-mismatch'],
    [{ ...normal, stdout: '17 11 R 0\n' }, 'present', 'invalid-rss'],
    [{ ...normal, status: 1, stdout: '' }, 'present', 'no-match-but-pid-present'],
    [{ ...normal, status: 1, stdout: '' }, 'error', 'kernel-lookup-unavailable'],
    [{ ...normal, status: 1, stdout: '\n' }, 'ESRCH', 'ps-failed'],
  ] as const) {
    const result = classifyRssProbe(17, 11, raw, () => lookup);
    expect(result.reading).toBeUndefined(); expect(result.observation).toMatchObject({ ps: { status: raw.status, signal: raw.signal, code: raw.code, stdout: raw.stdout, stderr: raw.stderr }, classification: 'unavailable', reason });
  }
});
test('first last failing trace preserves exact relevant observations and cannot grow with samples', () => {
  const first = classifyRssProbe(17, 11, normal, () => 'present').observation;
  const failed = classifyRssProbe(17, 11, { ...normal, code: 'EPERM', status: null, stdout: '', stderr: 'denied' }, () => 'error').observation;
  const last = classifyRssProbe(17, 11, { ...normal, stdout: '17 11 Z 0\n' }, () => 'present').observation;
  let trace: IRssTrace = { probes: 0, first: null, last: null, failing: null };
  trace = retainRssObservation(trace, first);
  for (let index = 0; index < 100; index++) { trace = retainRssObservation(trace, failed); }
  trace = retainRssObservation(trace, last);
  expect(trace).toEqual({ probes: 102, first, last, failing: failed });
  expect(Buffer.byteLength(JSON.stringify(trace))).toBeLessThanOrEqual(4096);
  const huge = classifyRssProbe(17, 11, { ...normal, status: null, stdout: '\u0000'.repeat(1024), stderr: '\u0000'.repeat(1024), code: 'X'.repeat(1024), signal: 'X'.repeat(1024) }, () => 'error').observation;
  expect(huge.ps.stdoutTruncated).toBe(true); expect(huge.ps.stdoutBytes).toBe(1024);
  expect(huge.ps.stderrTruncated).toBe(true); expect(huge.ps.stderrBytes).toBe(1024);
  expect(Buffer.byteLength(JSON.stringify(huge))).toBeLessThanOrEqual(1024);
});

/** Node can omit both streams on spawn EPERM despite its static encoding overload. */
test('host completion normalizes missing streams to null without turning them into empty no-match evidence', () => {
  const denied = normalizePsCompletion({ status: null, signal: null, error: { code: 'EPERM' }, stdout: undefined, stderr: undefined });
  expect(denied).toEqual({ status: null, signal: null, code: 'EPERM', stdout: null, stderr: null });
  const result = classifyRssProbe(17, 11, denied, () => 'ESRCH');
  expect(result.reading).toBeUndefined();
  expect(result.observation).toMatchObject({ ps: { status: null, code: 'EPERM', stdout: null, stdoutBytes: null, stderr: null, stderrBytes: null }, classification: 'unavailable', reason: 'ps-failed', kernelLookup: 'not-attempted' });
  const missing = classifyRssProbe(17, 11, normalizePsCompletion({ status: 1, signal: null }), () => 'ESRCH');
  expect(missing.reading).toBeUndefined(); expect(missing.observation.kernelLookup).toBe('not-attempted');
  const empty = classifyRssProbe(17, 11, normalizePsCompletion({ status: 1, signal: null, stdout: '', stderr: '' }), () => 'ESRCH');
  expect(empty.reading).toBe('not-running'); expect(empty.observation.ps.stdout).toBe('');
  expect(normalizePsCompletion({ status: 0, signal: null, stdout: normal.stdout, stderr: '' })).toEqual(normal);
});
