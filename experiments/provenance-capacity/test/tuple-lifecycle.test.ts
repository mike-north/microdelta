/** Protocol outcomes are tested independently of transport scheduling and domain computation. */
import { expect, test } from '@jest/globals';
import { createReleaseGate } from '../src/tuple-lifecycle.js';
import type { IReleaseGate } from '../src/tuple-lifecycle.js';

/** Controlled transport exercises callback/close permutations without pretending a send boolean is delivery. */
function fixture(options: { readonly finalRss: number | undefined; readonly send?: 'pending' | 'throw' } = { finalRss: 1024 }): { readonly gate: IReleaseGate; readonly events: string[]; readonly complete: (error: Error | null) => void } {
  const events: string[] = []; let complete: ((error: Error | null) => void) | undefined;
  const gate = createReleaseGate({ rssLimit: 2048, finalRss: () => { events.push('final-rss'); return options.finalRss; }, pauseSampling: () => { events.push('pause'); }, dispatch: (done) => { events.push('dispatch'); complete = done; if (options.send === 'throw') { throw new Error('send'); } return false; }, fail: (reason) => { events.push(`fail:${reason}`); }, settle: () => { events.push('settle'); } });
  return { gate, events, complete: (error) => { if (complete === undefined) { throw new Error('transport was not dispatched'); } complete(error); } };
}
test('ready requires positive final RSS before pending dispatch; false send boolean is only backpressure', () => {
  const f = fixture(); f.gate.message('tuple-ready');
  expect(f.events).toEqual(['final-rss', 'pause', 'dispatch']);
  expect(f.gate.state()).toEqual({ ready: true, finalRssBytes: 1024, releaseDispatched: true, releaseConfirmed: false, failure: null });
  f.complete(null); expect(f.events).not.toContain('settle');
  f.gate.closed(true, false); expect(f.events.at(-1)).toBe('settle'); expect(f.gate.state().releaseConfirmed).toBe(true);
});
test('normal close before send callback cannot settle until callback succeeds', () => {
  const f = fixture(); f.gate.message('tuple-ready'); f.gate.closed(true, false);
  expect(f.events).not.toContain('settle'); f.complete(null); expect(f.events.at(-1)).toBe('settle');
});
test('send error after normal close rejects rather than accepting the earlier close', () => {
  const f = fixture(); f.gate.message('tuple-ready'); f.gate.closed(true, false); f.complete(new Error('channel'));
  expect(f.gate.state().failure).toBe('release-send-failed'); expect(f.events.slice(-2)).toEqual(['fail:release-send-failed', 'settle']);
});
test('send throw and callback error before close stop but still await owned close', () => {
  for (const mode of ['throw', 'callback'] as const) {
    const f = fixture({ finalRss: 1024, send: mode === 'throw' ? 'throw' : 'pending' }); f.gate.message('tuple-ready'); if (mode === 'callback') { f.complete(new Error('channel')); }
    expect(f.gate.state().failure).toBe('release-send-failed'); expect(f.events).not.toContain('settle');
    f.gate.closed(false, true); expect(f.events.at(-1)).toBe('settle');
  }
});
test('no callback, released hang and early close remain bounded stops rather than success', () => {
  const missing = fixture(); missing.gate.message('tuple-ready'); missing.gate.closed(true, false); missing.gate.cancel('deadline');
  expect(missing.gate.state().releaseConfirmed).toBe(false); expect(missing.gate.state().failure).toBe('deadline'); expect(missing.events.at(-1)).toBe('settle');
  const hang = fixture(); hang.gate.message('tuple-ready'); hang.complete(null); hang.gate.cancel('deadline'); expect(hang.events).not.toContain('settle'); hang.gate.closed(false, true); expect(hang.events.at(-1)).toBe('settle');
  const early = fixture(); early.gate.closed(true, false); expect(early.gate.state().failure).toBe('closed-before-release'); expect(early.events).toEqual(['fail:closed-before-release', 'settle']);
});
test('invalid final RSS never pauses sampling or dispatches release', () => {
  for (const value of [undefined, 0, -1, Number.NaN, 2049]) {
    const f = fixture({ finalRss: value }); f.gate.message('tuple-ready'); expect(f.events).toEqual(['final-rss', 'fail:invalid-final-rss']); expect(f.gate.state().releaseDispatched).toBe(false);
    f.gate.closed(false, true); expect(f.events.at(-1)).toBe('settle');
  }
});
test('malformed, duplicate and out-of-order messages cannot confer release authority', () => {
  for (const value of ['tuple-release', {}, ['tuple-ready'], null]) { const f = fixture(); f.gate.message(value); expect(f.events).toEqual(['fail:invalid-or-duplicate-ready']); }
  const duplicate = fixture(); duplicate.gate.message('tuple-ready'); duplicate.gate.message('tuple-ready'); expect(duplicate.gate.state().failure).toBe('invalid-or-duplicate-ready');
  const late = fixture(); late.gate.closed(true, false); late.gate.message('tuple-ready'); expect(late.gate.state().releaseDispatched).toBe(false);
});
