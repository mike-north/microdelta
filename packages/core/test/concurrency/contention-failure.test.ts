/** Typed worker failure classification for the free-running C2 control. */
import { expect, test } from '@jest/globals';
import { HistoryBusyError, StaleWriterError } from '@microdelta/history';

import { classifyContentionFailure } from './contention-failure.js';
import { parseContentionLog } from './protocol.js';

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
