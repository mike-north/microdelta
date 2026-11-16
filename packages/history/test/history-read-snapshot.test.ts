/** Finite History ownership and causal failure controls; all host faults here are injected. */
import { describe, expect, test } from '@jest/globals';
import { SqliteBusyError } from '@microdelta/machine';
import type { ISqliteCoordinatedReadCapability, ISqliteReadStatement } from '@microdelta/machine';

import { HistoryBusyError } from '../src/durable/errors.js';
import { withHistoryReadSnapshot } from '../src/durable/read-snapshot.js';

/** An explicit entry represents a thrown value, including thrown undefined. */
interface IInjectedFailure {
  readonly stage: 'open' | 'begin' | 'prepare' | 'get' | 'all' | 'end' | 'close';
  readonly value: unknown;
}

/** A traceable inert capability proves ownership without implying native release evidence. */
function injectedScope(failures: readonly IInjectedFailure[] = []): {
  readonly sqlite: ISqliteCoordinatedReadCapability;
  readonly trace: string[];
} {
  const trace: string[] = [];
  const enter = (stage: IInjectedFailure['stage']): void => {
    trace.push(stage);
    const failure = failures.find((candidate) => candidate.stage === stage);
    if (failure !== undefined) { throw failure.value; }
  };
  const statement: ISqliteReadStatement = {
    get() { enter('get'); return { answer: 42 }; },
    all() { enter('all'); return [{ answer: 42 }]; },
  };
  return {
    trace,
    sqlite: {
      openSqliteCoordinatedRead() {
        enter('open');
        return {
          begin() { enter('begin'); },
          prepare() { enter('prepare'); return statement; },
          end() { enter('end'); },
          close() { enter('close'); },
        };
      },
    },
  };
}

/** Catching is explicit so a successful undefined return never proves thrown undefined. */
function failureOf(operation: () => unknown): unknown {
  try { operation(); } catch (error: unknown) { return error; }
  throw new Error('Expected the operation to fail');
}

describe('finite History snapshot ownership', () => {
  test('acquisition and begin precede work; end and close finish before the answer returns', () => {
    const fixture = injectedScope();
    const value = withHistoryReadSnapshot(fixture.sqlite, 'existing.sqlite', (read) => {
      expect(fixture.trace).toEqual(['open', 'begin']);
      expect(Object.keys(read)).toEqual(['prepare']);
      return read.prepare('SELECT answer').get()?.answer;
    });
    expect(value).toBe(42);
    expect(fixture.trace).toEqual(['open', 'begin', 'prepare', 'get', 'end', 'close']);
  });

  test('opening failure acquires no scope and remains the exact failure', () => {
    const primary = new Error('open refused');
    const fixture = injectedScope([{ stage: 'open', value: primary }]);
    expect(failureOf(() => withHistoryReadSnapshot(fixture.sqlite, 'existing.sqlite', () => 1))).toBe(primary);
    expect(fixture.trace).toEqual(['open']);
  });

  test('begin failure still attempts both release actions and never calls selection', () => {
    const primary = new Error('begin refused');
    const fixture = injectedScope([{ stage: 'begin', value: primary }]);
    let selected = false;
    expect(failureOf(() => withHistoryReadSnapshot(fixture.sqlite, 'existing.sqlite', () => {
      selected = true; return 1;
    }))).toBe(primary);
    expect(selected).toBe(false);
    expect(fixture.trace).toEqual(['open', 'begin', 'end', 'close']);
  });

  test('a failed end cannot suppress the close attempt or return ordinary success', () => {
    const primary = new Error('injected native end failure');
    const fixture = injectedScope([{ stage: 'end', value: primary }]);
    expect(failureOf(() => withHistoryReadSnapshot(fixture.sqlite, 'existing.sqlite', () => 42))).toBe(primary);
    expect(fixture.trace).toEqual(['open', 'begin', 'end', 'close']);
  });

  test('failed close after successful selection is a failure, not a delivered answer', () => {
    const primary = new Error('injected native close failure');
    const fixture = injectedScope([{ stage: 'close', value: primary }]);
    expect(failureOf(() => withHistoryReadSnapshot(fixture.sqlite, 'existing.sqlite', () => 42))).toBe(primary);
    expect(fixture.trace).toEqual(['open', 'begin', 'end', 'close']);
  });

  test('request, end and close failures remain in causal order without dropping any action', () => {
    const primary = new Error('query failed');
    const end = new Error('injected end failed');
    const close = new Error('injected close failed');
    const fixture = injectedScope([{ stage: 'end', value: end }, { stage: 'close', value: close }]);
    const error = failureOf(() => withHistoryReadSnapshot(fixture.sqlite, 'existing.sqlite', () => { throw primary; }));
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) { throw new Error('Expected causal aggregation'); }
    expect(error.errors).toEqual([primary, end, close]);
    expect(fixture.trace).toEqual(['open', 'begin', 'end', 'close']);
  });

  test('release-only aggregation does not invent a request failure', () => {
    const end = new Error('injected end failed');
    const close = new Error('injected close failed');
    const fixture = injectedScope([{ stage: 'end', value: end }, { stage: 'close', value: close }]);
    const error = failureOf(() => withHistoryReadSnapshot(fixture.sqlite, 'existing.sqlite', () => 42));
    if (!(error instanceof AggregateError)) { throw new Error('Expected release aggregation'); }
    expect(error.errors).toEqual([end, close]);
  });

  test('a single thrown undefined remains a failure after successful cleanup', () => {
    const fixture = injectedScope();
    expect(failureOf(() => withHistoryReadSnapshot(fixture.sqlite, 'existing.sqlite', () => { throw undefined; }))).toBeUndefined();
    expect(fixture.trace).toEqual(['open', 'begin', 'end', 'close']);
  });

  test('independent thrown undefined values are retained rather than treated as missing errors', () => {
    const fixture = injectedScope([{ stage: 'end', value: undefined }, { stage: 'close', value: undefined }]);
    const error = failureOf(() => withHistoryReadSnapshot(fixture.sqlite, 'existing.sqlite', () => { throw undefined; }));
    if (!(error instanceof AggregateError)) { throw new Error('Expected all three undefined failures'); }
    expect(error.errors).toEqual([undefined, undefined, undefined]);
    expect(fixture.trace).toEqual(['open', 'begin', 'end', 'close']);
  });

  test.each(['open', 'begin', 'prepare', 'get', 'all', 'end', 'close'] as const)('%s translates only Machine boundary contention and keeps its exact cause', (stage) => {
    const cause = new SqliteBusyError(`injected ${stage}`, 500);
    const fixture = injectedScope([{ stage, value: cause }]);
    const error = failureOf(() => withHistoryReadSnapshot(fixture.sqlite, 'existing.sqlite', (read) =>
      stage === 'all' ? read.prepare('SELECT answer').all() : read.prepare('SELECT answer').get()));
    expect(error).toBeInstanceOf(HistoryBusyError);
    if (!(error instanceof HistoryBusyError)) { throw new Error('Expected History-owned contention'); }
    expect(error.cause).toBe(cause);
    if (stage !== 'open') { expect(fixture.trace.slice(-2)).toEqual(['end', 'close']); }
  });

  test('boundary translation occurs before request/release aggregation', () => {
    const query = new SqliteBusyError('query', 500);
    const end = new SqliteBusyError('end', 500);
    const close = new SqliteBusyError('close', 500);
    const fixture = injectedScope([{ stage: 'get', value: query }, { stage: 'end', value: end }, { stage: 'close', value: close }]);
    const error = failureOf(() => withHistoryReadSnapshot(fixture.sqlite, 'existing.sqlite', (read) => read.prepare('SELECT answer').get()));
    if (!(error instanceof AggregateError)) { throw new Error('Expected translated causal aggregation'); }
    const failures: readonly unknown[] = error.errors;
    expect(failures).toHaveLength(3);
    expect(failures.map((failure) => failure instanceof HistoryBusyError ? failure.cause : failure)).toEqual([query, end, close]);
    expect(failures.every((failure) => failure instanceof HistoryBusyError)).toBe(true);
  });

  test('a non-SQLite operation throwing Machine busy is not mistaken for storage contention', () => {
    const cause = new SqliteBusyError('not raised by a SQLite call', 500);
    const fixture = injectedScope();
    expect(failureOf(() => withHistoryReadSnapshot(fixture.sqlite, 'existing.sqlite', () => { throw cause; }))).toBe(cause);
    expect(fixture.trace).toEqual(['open', 'begin', 'end', 'close']);
  });
});
