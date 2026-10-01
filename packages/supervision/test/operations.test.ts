/**
 * Run Supervision's external operations against in-memory port doubles, for
 * the failure paths the real stores make hard to reach on demand: a journal
 * or Accounting write that fails before the send, a usage acknowledgment
 * that fails or conflicts after it, a settlement the writer lease no longer
 * authorizes, damaged records, and malformed requests and run options. The
 * same behaviors on the real History and Accounting packages run in the
 * facade's assembly suites (`packages/core/test/operations`).
 *
 * Expected values come from the owner decisions: intent before send (a
 * failed intent write sends nothing), a usage acknowledgment that is not
 * durable is never claimed (ACC-007) and leaves usage unknown (ACC-005), and
 * a drain that lost its lease commits nothing (EXP-8 ruling R).
 *
 * @see ../../../docs/spec/operations.md (RUN-011, RUN-012, RUN-013, ACC-005, ACC-007)
 * @see ../../../experiments/exp-8/decision.md (mechanism 4, ruling R)
 */
import { describe, expect, test } from '@jest/globals';
import type { IResolution, IResolutionOutcome } from '@microdelta/resolution';

import { SupervisionError, createSupervision, operationsCollection } from '../src/index.js';
import type {
  IJournalEntry,
  IJournalLocation,
  IJournalWriteRequest,
  IOperationAccounting,
  IOperationJournalPort,
  IOperationRequest,
  IResolutionPorts,
  IRunEvent,
  IRunOptions,
} from '../src/index.js';
import { admissionFor, codeOf, fakeTimer, grantingWriter, nodeScopes, stepOf } from './support.js';

/** An in-memory journal port with failure injection. */
interface IMemoryJournal extends IOperationJournalPort {
  /** Commits refused from this commit number on (1-based); never when undefined. */
  failFrom: number | undefined;
  readonly commits: number;
  /** Store a raw record, as damage or an earlier process would. */
  put(collection: string, key: string, content: unknown, format?: string): void;
  /** The current content of one operation record. */
  operation(key: string): unknown;
}

/** Create an in-memory journal. */
function memoryJournal(): IMemoryJournal {
  const records = new Map<string, IJournalEntry>();
  const id = (address: Pick<IJournalLocation, 'environment' | 'collection' | 'key'>): string => JSON.stringify([address.environment, address.collection, address.key]);
  let commits = 0;
  const journal: IMemoryJournal = {
    failFrom: undefined,
    get commits(): number {
      return commits;
    },
    commit(_lease, request) {
      commits += 1;
      if (journal.failFrom !== undefined && commits >= journal.failFrom) {
        throw new Error('stale writer lease');
      }
      return request.writes.map((write: IJournalWriteRequest) => {
        const key = id({ environment: request.environment, collection: write.collection, key: write.key });
        const current = records.get(key)?.revision ?? 0;
        if (current !== write.expectedRevision) {
          throw new Error('journal conflict');
        }
        const entry = { key: write.key, revision: current + 1, record: write.record };
        records.set(key, entry);
        return entry;
      });
    },
    read: (address) => records.get(id(address)),
    list: (query) => [...records.entries()].filter(([key]) => key.startsWith(JSON.stringify([query.environment, query.collection]).slice(0, -1))).map(([, entry]) => entry),
    put(collection, key, content, format = 'microdelta.supervision.blocks') {
      records.set(id({ environment: 'env:test', collection, key }), { key, revision: 1, record: { format, formatVersion: 1, content } });
    },
    operation: (key) => records.get(id({ environment: 'env:test', collection: operationsCollection, key }))?.record.content,
  };
  return journal;
}

/** An in-memory Accounting port with failure injection. */
interface IMemoryAccounting extends IOperationAccounting {
  failIntents: boolean;
  failReports: boolean;
  conflict: boolean;
  readonly intents: string[];
  readonly reports: string[];
}

/** Create an in-memory Accounting. */
function memoryAccounting(): IMemoryAccounting {
  const accounting: IMemoryAccounting = {
    failIntents: false,
    failReports: false,
    conflict: false,
    intents: [],
    reports: [],
    recordUsageIntent(intent) {
      if (accounting.failIntents) {
        throw new Error('accounting busy');
      }
      accounting.intents.push(intent.requestAttempt);
      return 'recorded';
    },
    acknowledgeUsage(report) {
      if (accounting.failReports) {
        throw new Error('accounting durability unknown');
      }
      accounting.reports.push(report.report);
      return { kind: accounting.conflict ? 'conflict' : 'acknowledged' };
    },
  };
  return accounting;
}

/** A Resolution double whose `resolve` admits and executes one step that runs `body`, as Resolution would. */
function executing(body: () => Promise<unknown>): { readonly factory: IRunOptions['resolution']; ports(): IResolutionPorts } {
  let captured: IResolutionPorts | undefined;
  return {
    ports: () => {
      if (captured === undefined) {
        throw new Error('the run has not started');
      }
      return captured;
    },
    factory: (ports): IResolution => {
      captured = ports;
      const unused = (): Promise<never> => Promise.reject(new Error('unused'));
      return {
        async resolve(): Promise<IResolutionOutcome> {
          const step = stepOf('assess', 'pr-1');
          const admission = admissionFor(step);
          const decision = await ports.admission.admit(admission);
          if (decision.kind !== 'admitted') {
            return { kind: 'refused', refused: step, reason: decision.reason, disposition: decision.kind, step, misses: [], trace: [], diagnostics: [] };
          }
          const executed = await ports.execution.execute(step, body, { subject: admission.subject, attemptId: 7 });
          if (executed.kind === 'threw') {
            throw executed.error;
          }
          return { kind: 'refused', refused: step, reason: executed.kind, disposition: executed.kind === 'unsettled' ? 'denied' : 'cancelled', step, misses: [], trace: [], diagnostics: [] };
        },
        resolveMembers: unused,
        resolveFold: unused,
        check: unused,
        recover: (): never => {
          throw new Error('unused');
        },
      };
    },
  };
}

/** A minimal operation whose provider answers `answer`, counting sends. */
function operation(answer: () => Promise<Awaited<ReturnType<IOperationRequest<number>['perform']>>>, sent: { count: number }): IOperationRequest<number> {
  return {
    name: 'assess',
    binding: 'sha256:binding',
    perform: () => {
      sent.count += 1;
      return answer();
    },
  };
}

/** Run one step whose body performs `request`, returning the run's events, diagnostics and the body's failure code. */
async function runOne(journal: IMemoryJournal, accounting: IMemoryAccounting, request: () => IOperationRequest<number>): Promise<{ readonly code: string | undefined; readonly events: readonly IRunEvent[]; readonly diagnostics: readonly string[] }> {
  const timer = fakeTimer();
  const supervision = createSupervision({ context: nodeScopes, timer });
  let code: string | undefined;
  const double = executing(async () => {
    code = await codeOf(supervision.execution().operation(request()));
  });
  const events: IRunEvent[] = [];
  const result = await supervision.run({
    analysis: 'analysis:test',
    environment: 'env:test',
    runId: 'run:test',
    resolution: double.factory,
    writer: grantingWriter,
    operations: { journal, accounting },
    observers: [{ observe: (event) => events.push(event) }],
  }, (run) => run.resolve(stepOf('assess', 'pr-1'), { requestKey: 'request:1' }));
  return { code, events, diagnostics: result.diagnostics };
}

/** The operation phases of a run's events. */
function phases(events: readonly IRunEvent[]): string[] {
  return events.flatMap((event) => event.kind === 'operation' ? [`${event.phase}${event.reason === undefined ? '' : `:${event.reason}`}`] : []);
}

describe('intent before send (ACC-007)', () => {
  test('an intent the journal refuses sends nothing and fails as unrecorded', async () => {
    const journal = memoryJournal();
    journal.failFrom = 1;
    const sent = { count: 0 };
    const outcome = await runOne(journal, memoryAccounting(), () => operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent));
    expect(outcome.code).toBe('operation-unrecorded');
    expect(sent.count).toBe(0);
  });

  test('an Accounting intent that fails sends nothing, and the attempt is recorded as never sent', async () => {
    const journal = memoryJournal();
    const accounting = memoryAccounting();
    accounting.failIntents = true;
    const sent = { count: 0 };
    const outcome = await runOne(journal, accounting, () => operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent));
    expect(outcome.code).toBe('operation-unrecorded');
    expect(sent.count).toBe(0);
    expect(journal.operation('op-7-1')).toEqual(expect.objectContaining({ status: 'failed', attempts: [expect.objectContaining({ status: 'not-sent' })] }));
  });
});

describe('usage acknowledgment (ACC-005, ACC-007)', () => {
  test('a failed acknowledgment is never claimed: usage stays unknown, it is reported and diagnosed by code, and the outcome is still recorded', async () => {
    const journal = memoryJournal();
    const accounting = memoryAccounting();
    accounting.failReports = true;
    const outcome = await runOne(journal, accounting, () => operation(() => Promise.resolve({ kind: 'succeeded', value: 1, usage: { report: 'r-1', quantities: [{ unit: 'tokens', amount: 5 }] } }), { count: 0 }));
    expect(outcome.code).toBeUndefined();
    expect(phases(outcome.events)).toEqual(['request-started', 'usage-unrecorded:unrecorded', 'request-settled']);
    expect(outcome.diagnostics.filter((line) => line.startsWith('usage-unrecorded:'))).toHaveLength(1);
    expect(journal.operation('op-7-1')).toEqual(expect.objectContaining({ status: 'succeeded', attempts: [expect.objectContaining({ status: 'succeeded', usage: 'unrecorded' })] }));
  });

  test('a conflicting redelivery keeps the first report and is diagnosed', async () => {
    const accounting = memoryAccounting();
    accounting.conflict = true;
    const outcome = await runOne(memoryJournal(), accounting, () => operation(() => Promise.resolve({ kind: 'succeeded', value: 1, usage: { report: 'r-1', quantities: [] } }), { count: 0 }));
    expect(phases(outcome.events)).toContain('usage-unrecorded:conflict');
    expect(outcome.diagnostics.filter((line) => line.startsWith('usage-conflict:'))).toHaveLength(1);
    expect(accounting.reports).toEqual(['provider:r-1']);
  });
});

describe('lease authority (EXP-8 ruling R)', () => {
  test('an outcome the lease no longer authorizes is not recorded: the operation stays pending and the attempt ends pending as unknown', async () => {
    const journal = memoryJournal();
    // The intent commit succeeds; every later commit is refused, as for a lease lost while the request was in flight.
    journal.failFrom = 2;
    const outcome = await runOne(journal, memoryAccounting(), () => operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), { count: 0 }));
    expect(outcome.code).toBe('operation-unknown');
    expect(phases(outcome.events)).toEqual(['request-started', 'request-settled:lease-lost']);
    expect(journal.operation('op-7-1')).toEqual(expect.objectContaining({ status: 'pending' }));
    expect(outcome.diagnostics.some((line) => line.startsWith('lease-lost:'))).toBe(true);
  });
});

describe('malformed requests, options and records', () => {
  test.each([
    ['a name that is not an identifier', { name: 'Assess Now' }],
    ['an empty binding', { binding: '' }],
    ['zero attempts', { retry: { maxAttempts: 0 } }],
    ['a negative backoff', { retry: { backoffMilliseconds: -1 } }],
    ['a fractional rate-limit cap', { retry: { rateLimitRetries: 1.5 } }],
  ])('%s is refused as an invalid request before anything is recorded', async (_label, change) => {
    const journal = memoryJournal();
    const sent = { count: 0 };
    const outcome = await runOne(journal, memoryAccounting(), () => ({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), ...change }));
    expect(outcome.code).toBe('invalid-request');
    expect(journal.commits).toBe(0);
    expect(sent.count).toBe(0);
  });

  test('a run with operation ports but no timer, or an unknown deferral mode, is refused', async () => {
    const supervision = createSupervision({ context: nodeScopes });
    const double = executing(() => Promise.resolve());
    const base = { analysis: 'analysis:test', environment: 'env:test', resolution: double.factory, writer: grantingWriter };
    expect(await codeOf(supervision.run({ ...base, operations: { journal: memoryJournal(), accounting: memoryAccounting() } }, () => 'ran'))).toBe('invalid-request');
    const timed = createSupervision({ context: nodeScopes, timer: fakeTimer() });
    // A mode outside the closed set, as untyped configuration could supply.
    const untyped: IRunOptions = { ...base };
    Reflect.set(untyped, 'deferral', 'wait');
    expect(await codeOf(timed.run(untyped, () => 'ran'))).toBe('invalid-request');
  });

  test('a block index naming a missing operation is integrity damage, never a silent admission', async () => {
    const journal = memoryJournal();
    journal.put('microdelta.supervision.blocks', JSON.stringify(['assess', 1]), { subject: 'assess', version: 1, operations: [{ operation: 'op-missing', name: 'assess', binding: 'b' }] });
    const supervision = createSupervision({ context: nodeScopes, timer: fakeTimer() });
    const double = executing(() => Promise.resolve());
    await supervision.run({ analysis: 'analysis:test', environment: 'env:test', resolution: double.factory, writer: grantingWriter, operations: { journal, accounting: memoryAccounting() } }, async () => {
      const failure = await Promise.resolve().then(() => double.ports().admission.admit(admissionFor(stepOf('assess', 'pr-1')))).then(() => undefined, (error: unknown) => error);
      expect(failure instanceof SupervisionError ? failure.code : failure).toBe('integrity');
    });
  });
});
