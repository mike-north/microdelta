/** Typed worker failure classification for the free-running C2 control. */
import { expect, test } from '@jest/globals';
import { HistoryBusyError, StaleWriterError } from '@microdelta/history';

import { classifyContentionFailure } from './contention-failure.js';
import { classifyGrantedWorkFailure } from './granted-work-failure.js';
import { parseContentionLog, parseWaitContention } from './protocol.js';

test('C2 classifies only exact History busy and stale-writer failures', () => {
  // Classification uses runtime class identity; the exact Machine cause is checked by history-busy.test.ts.
  const historyBusy: unknown = Reflect.construct(HistoryBusyError, ['busy', new Error('host busy')]);
  expect(classifyContentionFailure(historyBusy)).toEqual({ errorKind: 'storage-busy', errorName: 'HistoryBusyError' });
  expect(classifyContentionFailure(new StaleWriterError('stale'))).toEqual({ errorKind: 'stale-writer', errorName: 'StaleWriterError' });
  expect(() => classifyContentionFailure(Object.assign(new Error('raw host busy'), { name: 'SqliteBusyError' }))).toThrow('Unexpected History contention failure');
  expect(() => classifyContentionFailure(Object.assign(new Error('fake'), { name: 'HistoryBusyError' }))).toThrow('Unexpected History contention failure');
});

test('C2 parser rejects unknown or mismatched refusal classes', () => {
  const event = { op: 'allocate', ok: false, fence: 1 };
  expect(parseContentionLog([{ ...event, errorKind: 'storage-busy', errorName: 'HistoryBusyError' }])).toHaveLength(1);
  expect(() => parseContentionLog([{ ...event, errorKind: 'storage-busy', errorName: 'SqliteBusyError' }])).toThrow('allocate');
  expect(() => parseContentionLog([{ ...event, errorKind: 'unrelated', errorName: 'Error' }])).toThrow('allocate');
  expect(() => parseContentionLog([{ ...event, errorKind: 'stale-writer', errorName: 'HistoryBusyError' }])).toThrow('allocate');
  expect(() => parseContentionLog([{ ...event, error: 'StaleWriterError' }])).toThrow('allocate');
  expect(() => parseContentionLog([{ ...event, ok: true, errorKind: 'storage-busy', errorName: 'HistoryBusyError' }])).toThrow('allocate');
  expect(() => parseContentionLog([{ ...event }])).toThrow('allocate');
  expect(() => parseContentionLog([{ op: 'acquire', ok: false, fence: 0, errorKind: 'storage-busy', errorName: 'HistoryBusyError' }])).toThrow('acquire');
});

test('C3 keeps a granted fence when a named post-grant History operation is storage-busy', () => {
  const historyBusy: unknown = Reflect.construct(HistoryBusyError, ['busy', new Error('host busy')]);
  expect(classifyGrantedWorkFailure('allocate', 7, historyBusy)).toEqual({
    kind: 'storage-busy', phase: 'allocate', fence: 7, errorName: 'HistoryBusyError',
  });
  expect(() => classifyGrantedWorkFailure('stage', 7, new StaleWriterError('stale')))
    .toThrow('Unexpected post-grant History failure');
  expect(classifyGrantedWorkFailure('stage', 7, historyBusy)).toMatchObject({ kind: 'storage-busy', phase: 'stage', fence: 7 });
  expect(classifyGrantedWorkFailure('publish', 7, historyBusy)).toMatchObject({ kind: 'storage-busy', phase: 'publish', fence: 7 });
  expect(() => classifyGrantedWorkFailure('publish', 7, Object.assign(new Error('raw busy'), { name: 'HistoryBusyError' })))
    .toThrow('Unexpected post-grant History failure');
  expect(() => classifyGrantedWorkFailure('allocate', 7, new Error('unrelated failure')))
    .toThrow('Unexpected post-grant History failure');
});

test('C3 wait parser requires every grant to have either a publication or a typed named post-grant refusal', () => {
  expect(parseWaitContention([{ kind: 'granted', fence: 3, tries: 2, published: 'result:3' }])).toMatchObject([{ fence: 3, published: 'result:3' }]);
  expect(parseWaitContention([{ kind: 'granted', fence: 3, tries: 2, published: null, postGrantFailure: { kind: 'storage-busy', phase: 'allocate', error: 'HistoryBusyError' } }]))
    .toMatchObject([{ fence: 3, published: null, postGrantFailure: { phase: 'allocate' } }]);
  expect(() => parseWaitContention([{ kind: 'granted', fence: 3, tries: 2, published: null }])).toThrow('identify its typed post-grant failure');
  expect(() => parseWaitContention([{ kind: 'granted', fence: 3, tries: 2, published: 'invented', postGrantFailure: { kind: 'storage-busy', phase: 'allocate', error: 'HistoryBusyError' } }]))
    .toThrow('cannot claim publication');
});
