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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeClock, createNodeElapsedClock, createNodeRandom, createNodeSqlite, createNodeSqliteReader, createNodeTimer } from '@microdelta/machine-node';
import { ResolutionError } from '@microdelta/resolution';
import type { IFoldResolution, IResolution, IResolutionOutcome } from '@microdelta/resolution';

import { SupervisionError, createSharedRateCoordinator, createStopController, createSupervision, openExecutionObservationReader, operationJournalDeclaration, operationsCollection } from '../src/index.js';
import { decodeOperation, encodeOperation } from '../src/records.js';
import { _inspectSharedRateDebits } from '../src/shared-rate-coordinator.js';
import type {
  IJournalEntry,
  IJournalLocation,
  IJournalWriteRequest,
  IOperationAccounting,
  IOperationJournalPort,
  IOperationRequest,
  IResolutionPorts,
  IRun,
  IRunEvent,
  IRunOptions,
  IRunRandom,
  IStopController,
  ISupervision,
  IWaitEvent,
} from '../src/index.js';
import { T0, admissionFor, codeOf, fakeTimer, grantingWriter, nodeScopes, settle, stepOf } from './support.js';

/** An in-memory journal port with failure injection. */
interface IMemoryJournal extends IOperationJournalPort {
  /** Commits refused from this commit number on (1-based); never when undefined. */
  failFrom: number | undefined;
  readonly commits: number;
  /** Store a raw record, as damage or an earlier process would. */
  put(collection: string, key: string, content: unknown, format?: string, formatVersion?: number): void;
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
        const entry = { key: write.key, revision: current + 1, fence: 1, record: write.record };
        records.set(key, entry);
        return entry;
      });
    },
    read: (address) => records.get(id(address)),
    list: (query) => [...records.entries()].filter(([key]) => key.startsWith(JSON.stringify([query.environment, query.collection]).slice(0, -1))).map(([, entry]) => entry),
    put(collection, key, content, format = 'microdelta.supervision.blocks', formatVersion = 1) {
      records.set(id({ environment: 'env:test', collection, key }), { key, revision: 1, fence: 1, record: { format, formatVersion, content } });
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
        resolveOutcomeFold: unused,
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

/** A deterministic random identifier source: 32 hexadecimal characters counting up from 1. */
function countingRandom(): IRunRandom {
  let next = 0;
  return {
    randomIdentifier: () => {
      next += 1;
      return next.toString(16).padStart(32, '0');
    },
  };
}

/** The identity of the first operation a fresh {@link countingRandom} mints. */
const firstOperation = `op-${'1'.padStart(32, '0')}`;

/** Run one step whose body performs `request`, returning the run's events, diagnostics, the body's failure code and how its execution ended. */
async function runOne(journal: IMemoryJournal, accounting: IMemoryAccounting, request: () => IOperationRequest<number>, random: IRunRandom = countingRandom()): Promise<{ readonly code: string | undefined; readonly result: string; readonly events: readonly IRunEvent[]; readonly diagnostics: readonly string[] }> {
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
    // Exit mode: a short deferral returns at once instead of sleeping on the controlled timer.
    deferral: 'exit',
    resolution: double.factory,
    writer: grantingWriter,
    operations: { journal, accounting, random },
    observers: [{ observe: (event) => events.push(event) }],
  }, (run) => run.resolve(stepOf('assess', 'pr-1'), { requestKey: 'request:1' }));
  const outcome = result.value;
  return { code, result: outcome.kind === 'refused' ? outcome.reason : outcome.kind, events, diagnostics: result.diagnostics };
}

/** The operation phases of a run's events. */
function phases(events: readonly IRunEvent[]): string[] {
  return events.flatMap((event) => event.kind === 'operation' ? [`${event.phase}${event.reason === undefined ? '' : `:${event.reason}`}`] : []);
}

/**
 * A large receipt array is an owner-boundary probe, not an application scale
 * workload. Repeated guarded admissions of one genuinely retained operation
 * contribute real deferral samples through the normal operation port without
 * constructing thousands of graph members, providers or durable stores.
 */
describe('terminal deferred receipts have no JavaScript argument-count ceiling (RUN-010/011)', () => {
  test('a failed request reduces 200000 genuine guarded deferral samples without losing its typed outcome', async () => {
    const timer = fakeTimer();
    const supervision = createSupervision({ context: nodeScopes, timer });
    const journal = memoryJournal();
    const accounting = memoryAccounting();
    const sent = { count: 0 };
    const floor = T0 + 10_000;
    const deferredStep = stepOf('assess', 'pr-1');
    const failedStep = stepOf('independent', 'pr-2');
    const foldStep = stepOf('report');
    let passes = 0;
    let denied = 0;
    const double = executing(async () => {
      await supervision.execution().operation({
        ...operation(() => Promise.resolve({ kind: 'rate-limited', retryAt: floor }), sent),
        retry: { maxAttempts: 2 },
      }).catch(() => undefined);
    });
    const factory: IRunOptions['resolution'] = (ports): IResolution => {
      const delegate = double.factory(ports);
      return {
        ...delegate,
        async resolveFold(request): Promise<IFoldResolution> {
          passes += 1;
          const pending = await delegate.resolve({ ...request, step: deferredStep });
          // Each admission consults the actual retained block and records its
          // floor through Operation Engine, rather than injecting a scope array.
          for (let index = 0; index < 200_000; index += 1) {
            const decision = await ports.admission.admit(admissionFor(deferredStep));
            if (decision.kind === 'denied') { denied += 1; }
          }
          const evidence = { misses: [], trace: [], diagnostics: [] };
          return {
            over: stepOf('assess'),
            discovery: { kind: 'keyed', collection: stepOf('prs'), reference: { kind: 'completed-result', locator: 'mdh1:test:roster' }, completion: 'complete', keys: ['pr-1', 'pr-2'] },
            members: [
              { key: 'pr-1', step: deferredStep, gate: { selected: 'required', observations: [] }, outcome: pending },
              { key: 'pr-2', step: failedStep, gate: { selected: 'required', observations: [] }, outcome: { kind: 'failed', error: new ResolutionError('execution-failure', 'independent member failed') } },
            ],
            outcome: { ...evidence, step: request.step, kind: 'failed', failed: ['pr-2'], cancelled: [], pending: ['pr-1'], openDiscovery: false, diagnostic: 'required member failed' },
            diagnostics: [],
          };
        },
      };
    };
    const events: IRunEvent[] = [];
    const result = await supervision.run({
      analysis: 'analysis:test', environment: 'env:test', resolution: factory, writer: grantingWriter,
      operations: { journal, accounting, random: countingRandom() },
      observers: [{ observe: (event) => { if (event.kind === 'wait') { events.push(event); } } }],
    }, (run) => run.resolveFold(foldStep, { requestKey: 'request:large-receipt' }));
    expect(result.value.outcome).toMatchObject({ status: 'failed', failed: ['pr-2'], pending: ['pr-1'] });
    expect(result.value.members.find((member) => member.key === 'pr-1')).toMatchObject({ status: 'pending', blocked: { kind: 'deferred', operation: firstOperation, notBefore: floor } });
    expect(result.waitingUntil).toBe(floor);
    expect({ passes, denied, sent: sent.count, intents: accounting.intents.length }).toEqual({ passes: 1, denied: 200_000, sent: 1, intents: 1 });
    expect(events).toEqual([]);
    expect(timer.currentEpochMilliseconds()).toBe(T0);
    expect(timer.scheduled.map((entry) => entry.at)).not.toContain(floor);
  }, 30_000);
});

describe('observed external operations and deferred waits (A-21c/d)', () => {
  test('two deferred required works retain the earliest wait, with exact operation and wait route counts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observed-operation-'));
    try {
      const timer = fakeTimer();
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervision = createSupervision({ context: nodeScopes, timer, observation: host });
      const journal = memoryJournal();
      const accounting = memoryAccounting();
      const sent = { count: 0 };
      const delays = [T0 + 30_000, T0 + 10_000];
      let next = 0;
      const factory: IRunOptions['resolution'] = (ports): IResolution => {
        const unused = (): Promise<never> => Promise.reject(new Error('unused'));
        return {
          async resolve(request): Promise<IResolutionOutcome> {
            const admission = admissionFor(request.step);
            const decision = await ports.admission.admit(admission);
            if (decision.kind !== 'admitted') { throw new Error('required work was not admitted'); }
            const executed = await ports.execution.execute(request.step, async () => {
              const position = next;
              const until = delays[position];
              next += 1;
              if (until === undefined) { throw new Error('unexpected resolution pass'); }
              await codeOf(supervision.execution().operation({
                ...operation(() => Promise.resolve({ kind: 'rate-limited', retryAt: until }), sent),
                name: `assess:${String(position)}`,
                binding: `sha256:binding:${String(position)}`,
                retry: { maxAttempts: 2 },
              }));
            }, { subject: admission.subject, attemptId: next + 1 });
            if (executed.kind === 'threw') { throw executed.error; }
            return { kind: 'refused', refused: request.step, reason: executed.kind, disposition: executed.kind === 'unsettled' ? 'denied' : 'cancelled', step: request.step, misses: [], trace: [], diagnostics: [] };
          },
          resolveMembers: unused, resolveFold: unused, resolveOutcomeFold: unused, check: unused,
          recover: (): never => { throw new Error('unused'); },
        };
      };
      const events: IRunEvent[] = [];
      const observed = supervision.startObserved({
        analysis: 'analysis:test', environment: 'env:test', deferral: 'exit',
        resolution: factory, writer: grantingWriter,
        operations: { journal, accounting, random: countingRandom() },
        observers: [{ observe: (event) => { events.push(event); } }],
        observationLocation: join(directory, 'deferred.sqlite'),
      }, async (run) => {
        await run.resolve(stepOf('first'), { requestKey: 'request:first' });
        await run.resolve(stepOf('second'), { requestKey: 'request:second' });
        return 'pending';
      });
      const result = await observed.result;
      expect({ sent: sent.count, bodyCalls: next, waits: events.filter((event) => event.kind === 'wait').map((event) => event.kind === 'wait' ? event.until : undefined), until: result.waitingUntil }).toEqual({ sent: 2, bodyCalls: 2, waits: [T0 + 30_000, T0 + 10_000], until: T0 + 10_000 });
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const document = reader.read();
      expect(document.result.kind).toBe('observed');
      const operationEvents = events.filter((event) => event.kind === 'operation');
      const waits = events.filter((event) => event.kind === 'wait');
      expect(operationEvents.length).toBeGreaterThan(0);
      expect(waits.map((event) => event.kind === 'wait' ? event.until : undefined)).toEqual([T0 + 30_000, T0 + 10_000]);
      if (document.result.kind === 'observed') {
        expect(document.result.observation.waitingUntil).toBe(T0 + 10_000);
        expect(document.result.observation.eventCounts.operation).toBe(operationEvents.length);
        expect(document.result.observation.eventCounts.wait).toBe(2);
        expect(document.result.observation.eventCounts.lowerBound).toBe(false);
      }
      expect(JSON.stringify(document)).not.toContain('request:first');
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('a retry-position observation write fault and throwing send observer preserve dispatch, journal and deferral policy', async () => {
    /** Two equivalent runs differ only in their observation-only fault injection. */
    async function scenario(faulted: boolean) {
      const directory = mkdtempSync(join(tmpdir(), 'microdelta-observed-retry-'));
      try {
        const real = createNodeSqlite();
        let faultedWrites = 0;
        const sqlite = {
          openSqlite(location: string, configuration?: { journalMode: 'wal' | 'delete'; creation?: 'exclusive' }) {
            const connection = real.openSqlite(location, configuration);
            return { ...connection, prepare(sql: string) {
              const statement = connection.prepare(sql);
              if (!sql.startsWith('UPDATE microdelta_execution_observation')) { return statement; }
              return { ...statement, run: (...values: readonly (string | number | null | Uint8Array)[]) => {
                if (faulted && faultedWrites === 0) { faultedWrites += 1; throw new Error('observation write unavailable'); }
                return statement.run(...values);
              } };
            } };
          },
        };
        let elapsed = 0;
        let ordinaryCallback: (() => void) | undefined;
        const host = {
          sqlite, reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(),
          elapsedClock: { currentElapsedMilliseconds: () => elapsed },
          timer: { currentEpochMilliseconds: () => T0, schedule(_at: number, callback: () => void) { ordinaryCallback = callback; return () => { ordinaryCallback = undefined; }; } },
        };
        const supervision = createSupervision({ context: nodeScopes, timer: fakeTimer(), observation: host });
        const journal = memoryJournal();
        const accounting = memoryAccounting();
        const sent = { count: 0 };
        const double = executing(async () => {
          await codeOf(supervision.execution().operation({
            ...operation(() => Promise.resolve({ kind: 'rate-limited', retryAt: T0 + 10_000 }), sent),
            retry: { maxAttempts: 2 },
          }));
        });
        const events: IRunEvent[] = [];
        let injectedAtRetry = 0;
        const observed = supervision.startObserved({
          analysis: 'analysis:test', environment: 'env:test', runId: 'run:test', deferral: 'exit',
          resolution: double.factory, writer: grantingWriter,
          operations: { journal, accounting, random: countingRandom() },
          observationLocation: join(directory, 'retry.sqlite'),
          observers: [{ observe(event) {
            events.push(event);
            if (event.kind === 'send' && event.phase === 'begin' && faulted) { throw new Error('user observer failed'); }
            if (event.kind === 'operation' && event.phase === 'retry-scheduled') {
              injectedAtRetry += 1;
              elapsed = 1000;
              ordinaryCallback?.();
            }
          } }],
        }, (run) => run.resolve(stepOf('assess', 'pr-1'), { requestKey: 'request:one' }));
        const result = await observed.result;
        const receipt = await observed.acknowledgment;
        const reader = openExecutionObservationReader(host.reader, observed.locator);
        const document = reader.read();
        reader.close();
        return {
          policy: { sent: sent.count, intents: [...accounting.intents], journal: journal.operation(firstOperation), waitingUntil: result.waitingUntil, outcome: result.value.kind, phases: phases(events) },
          receipt, document, injectedAtRetry, faultedWrites,
          sendEvents: events.filter((event) => event.kind === 'send').length,
          operationEvents: events.filter((event) => event.kind === 'operation').length,
        };
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
    const control = await scenario(false);
    const faulted = await scenario(true);
    expect(control.policy).toEqual(faulted.policy);
    expect(control.policy.sent).toBe(1);
    expect(control.policy.waitingUntil).toBe(T0 + 10_000);
    expect(control.injectedAtRetry).toBe(1);
    expect(faulted.injectedAtRetry).toBe(1);
    expect(faulted.faultedWrites).toBe(1);
    expect(control.receipt).toMatchObject({ kind: 'acknowledged' });
    expect(faulted.receipt).toMatchObject({ kind: 'acknowledged', observationFaults: { count: 1, lowerBound: false } });
    expect(faulted.document).toMatchObject({ result: { kind: 'observed', observation: { eventCounts: { send: faulted.sendEvents, operation: faulted.operationEvents }, observationFaults: { count: 1, lowerBound: false } } } });
  });
});

describe('intent before send (ACC-007)', () => {
  test('a hard stop from send-begin after durable intents records no provider call or sent operation attempt', async () => {
    const journal = memoryJournal();
    const accounting = memoryAccounting();
    const stop = createStopController();
    const sent = { count: 0 };
    const supervision = createSupervision({ context: nodeScopes, timer: fakeTimer() });
    let code: string | undefined;
    const double = executing(async () => {
      code = await codeOf(supervision.execution().operation(operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent)));
    });
    const events: IRunEvent[] = [];
    const result = await supervision.run({
      analysis: 'analysis:test', environment: 'env:test', runId: 'run:test', deferral: 'exit',
      resolution: double.factory, writer: grantingWriter,
      operations: { journal, accounting, random: countingRandom() }, stop,
      observers: [{ observe: (event) => {
        events.push(event);
        if (event.kind === 'send' && event.phase === 'begin' && event.label === 'assess') {
          stop.request({ level: 'hard' });
        }
      } }],
    }, (run) => run.resolve(stepOf('assess', 'pr-1'), { requestKey: 'request:1' }));
    expect(code).toBe('stopped');
    expect(sent.count).toBe(0);
    expect(accounting.intents).toEqual([`${firstOperation}/1`]);
    expect(accounting.reports).toEqual([]);
    expect(journal.operation(firstOperation)).toEqual(expect.objectContaining({
      status: 'deferred', attempts: [expect.objectContaining({ requestAttempt: `${firstOperation}/1`, status: 'not-sent' })],
    }));
    expect(result.value.kind).toBe('refused');
    expect(result.interruptions).toEqual([]);
    expect(phases(events)).not.toContain('request-started');
    expect(events.filter((event) => event.kind === 'send').map((event) => event.phase)).toEqual(['begin', 'refused']);
  });

  test('a hard stop from the Accounting intent callback is rechecked before send-begin', async () => {
    const journal = memoryJournal();
    const accounting = memoryAccounting();
    const recordIntent = accounting.recordUsageIntent.bind(accounting);
    const stop = createStopController();
    accounting.recordUsageIntent = (intent) => {
      const outcome = recordIntent(intent);
      stop.request({ level: 'hard' });
      return outcome;
    };
    const sent = { count: 0 };
    const supervision = createSupervision({ context: nodeScopes, timer: fakeTimer() });
    let code: string | undefined;
    const double = executing(async () => {
      code = await codeOf(supervision.execution().operation(operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent)));
    });
    const events: IRunEvent[] = [];
    const result = await supervision.run({
      analysis: 'analysis:test', environment: 'env:test', runId: 'run:test', deferral: 'exit',
      resolution: double.factory, writer: grantingWriter,
      operations: { journal, accounting, random: countingRandom() }, stop,
      observers: [{ observe: (event) => events.push(event) }],
    }, (run) => run.resolve(stepOf('assess', 'pr-1'), { requestKey: 'request:1' }));
    expect(code).toBe('stopped');
    expect(sent.count).toBe(0);
    expect(accounting.intents).toEqual([`${firstOperation}/1`]);
    expect(journal.operation(firstOperation)).toEqual(expect.objectContaining({
      status: 'deferred', attempts: [expect.objectContaining({ status: 'not-sent' })],
    }));
    expect(result.interruptions).toEqual([]);
    expect(events.filter((event) => event.kind === 'send').map((event) => event.phase)).toEqual(['refused']);
    expect(phases(events)).not.toContain('request-started');
  });

  test('failed restoration after pre-dispatch stop leaves the pending journal row conservative', async () => {
    const journal = memoryJournal();
    journal.failFrom = 2;
    const accounting = memoryAccounting();
    const stop = createStopController();
    const sent = { count: 0 };
    const supervision = createSupervision({ context: nodeScopes, timer: fakeTimer() });
    let code: string | undefined;
    const double = executing(async () => {
      code = await codeOf(supervision.execution().operation(operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent)));
    });
    const events: IRunEvent[] = [];
    const result = await supervision.run({
      analysis: 'analysis:test', environment: 'env:test', runId: 'run:test', deferral: 'exit',
      resolution: double.factory, writer: grantingWriter,
      operations: { journal, accounting, random: countingRandom() }, stop,
      observers: [{ observe: (event) => {
        events.push(event);
        if (event.kind === 'send' && event.phase === 'begin') {
          stop.request({ level: 'hard' });
        }
      } }],
    }, (run) => run.resolve(stepOf('assess', 'pr-1'), { requestKey: 'request:1' }));
    expect(code).toBe('stopped');
    expect(sent.count).toBe(0);
    expect(journal.operation(firstOperation)).toEqual(expect.objectContaining({
      status: 'pending', attempts: [expect.objectContaining({ status: 'pending' })],
    }));
    expect(accounting.intents).toEqual([`${firstOperation}/1`]);
    expect(result.interruptions).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.stringContaining('stays pending after pre-dispatch stop'));
    expect(phases(events)).not.toContain('request-started');
  });

  test('a hard stop from request-started follows the post-dispatch remote-unknown path', async () => {
    const journal = memoryJournal();
    const accounting = memoryAccounting();
    const stop = createStopController();
    const sent = { count: 0 };
    const supervision = createSupervision({ context: nodeScopes, timer: fakeTimer() });
    let code: string | undefined;
    const double = executing(async () => {
      code = await codeOf(supervision.execution().operation(operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent)));
    });
    const events: IRunEvent[] = [];
    const result = await supervision.run({
      analysis: 'analysis:test', environment: 'env:test', runId: 'run:test', deferral: 'exit',
      resolution: double.factory, writer: grantingWriter,
      operations: { journal, accounting, random: countingRandom() }, stop,
      observers: [{ observe: (event) => {
        events.push(event);
        if (event.kind === 'operation' && event.phase === 'request-started') {
          stop.request({ level: 'hard' });
        }
      } }],
    }, (run) => run.resolve(stepOf('assess', 'pr-1'), { requestKey: 'request:1' }));
    expect(code).toBe('stopped');
    expect(sent.count).toBe(1);
    expect(journal.operation(firstOperation)).toEqual(expect.objectContaining({
      status: 'unknown', attempts: [expect.objectContaining({ status: 'unknown', remote: 'unknown' })],
    }));
    expect(result.interruptions).toEqual([{ label: 'assess', remote: 'unknown' }]);
    expect(events.filter((event) => event.kind === 'operation' && event.phase === 'request-started')).toEqual([
      expect.objectContaining({ requestAttempt: `${firstOperation}/1`, status: 'pending' }),
    ]);
  });

  test('a synchronous provider throw still emits one request-started event for the invoked attempt', async () => {
    const journal = memoryJournal();
    const sent = { count: 0 };
    const outcome = await runOne(journal, memoryAccounting(), () => operation(() => {
      throw new Error('provider synchronously refused');
    }, sent));
    expect(sent.count).toBe(1);
    expect(outcome.events.filter((event) => event.kind === 'operation' && event.phase === 'request-started')).toEqual([
      expect.objectContaining({ requestAttempt: `${firstOperation}/1`, status: 'pending' }),
    ]);
    expect(journal.operation(firstOperation)).toEqual(expect.objectContaining({
      status: 'unknown', notBefore: T0 + 2_000,
      classification: expect.objectContaining({
        kind: 'accepted', decision: { kind: 'retry-after', delayMilliseconds: 2_000 }, notBefore: T0 + 2_000,
      }),
      attempts: [expect.objectContaining({
        requestAttempt: `${firstOperation}/1`, status: 'unknown', usage: 'none',
        decision: { kind: 'retry-after', delayMilliseconds: 2_000 },
      })],
    }));
  });

  test('an intent the journal refuses sends nothing and leaves the attempt pending on a short deferral, never failed', async () => {
    const journal = memoryJournal();
    journal.failFrom = 1;
    const sent = { count: 0 };
    const outcome = await runOne(journal, memoryAccounting(), () => operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent));
    expect(outcome.code).toBe('operation-deferred');
    expect(outcome.result).toBe('unsettled');
    expect(sent.count).toBe(0);
    expect(phases(outcome.events)).toEqual(['retry-scheduled:unrecorded']);
  });

  test('an Accounting intent that fails sends nothing, records the attempt never sent and the operation deferred briefly, and leaves the step pending', async () => {
    const journal = memoryJournal();
    const accounting = memoryAccounting();
    accounting.failIntents = true;
    const sent = { count: 0 };
    const outcome = await runOne(journal, accounting, () => operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent));
    expect(outcome.code).toBe('operation-deferred');
    expect(outcome.result).toBe('unsettled');
    expect(sent.count).toBe(0);
    expect(journal.operation(firstOperation)).toEqual(expect.objectContaining({ status: 'deferred', notBefore: T0 + 1_000, attempts: [expect.objectContaining({ status: 'not-sent' })] }));
  });

  test.each([
    ['not hexadecimal', 'NOT RANDOM'],
    ['upper-case hexadecimal', 'ABCDEF0123456789ABCDEF0123456789'],
    ['31 characters', '0123456789abcdef0123456789abcde'],
    ['33 characters', '0123456789abcdef0123456789abcdef0'],
    ['alphanumeric beyond hexadecimal', '0123456789abcdefghij0123456789ab'],
  ])('an identifier from the random source that is %s is refused before anything is recorded', async (_label, identifier) => {
    const journal = memoryJournal();
    const sent = { count: 0 };
    const outcome = await runOne(journal, memoryAccounting(), () => operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), { randomIdentifier: () => identifier });
    expect(outcome.code).toBe('invalid-request');
    expect(journal.commits).toBe(0);
    expect(sent.count).toBe(0);
  });

  test('a repeatedly non-durable intent backs off exponentially, durably and visibly, up to the cap, and a durable one ends the backoff', async () => {
    const journal = memoryJournal();
    const accounting = memoryAccounting();
    accounting.failIntents = true;
    const timer = fakeTimer();
    const supervision = createSupervision({ context: nodeScopes, timer });
    const random = countingRandom();
    const sent = { count: 0 };
    const double = executing(async () => {
      await supervision.execution().operation(operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent)).catch(() => undefined);
    });
    const delays: number[] = [];
    const events: IRunEvent[] = [];
    for (let round = 0; round < 9; round += 1) {
      const before = timer.currentEpochMilliseconds();
      await supervision.run({
        analysis: 'analysis:test',
        environment: 'env:test',
        deferral: 'exit',
        resolution: double.factory,
        writer: grantingWriter,
        operations: { journal, accounting, random },
        observers: [{ observe: (event) => events.push(event) }],
      }, (run) => run.resolve(stepOf('assess', 'pr-1'), { requestKey: `request:${String(round)}` }));
      const recorded = journal.operation(firstOperation);
      const notBefore: unknown = typeof recorded === 'object' && recorded !== null ? Reflect.get(recorded, 'notBefore') : undefined;
      // A plain failure recorded nothing, so each retry is a fresh request attempt and the earlier ones stay not sent.
      expect(recorded).toEqual(expect.objectContaining({ status: 'deferred', attempts: Array.from({ length: round + 1 }, () => expect.objectContaining({ status: 'not-sent', intent: null })) }));
      delays.push(typeof notBefore === 'number' ? notBefore - before : Number.NaN);
      timer.advance(typeof notBefore === 'number' ? notBefore - before : 0);
    }
    // 1 s, doubling, capped at 60 s.
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
    expect(phases(events).filter((phase) => phase === 'retry-scheduled:unrecorded')).toHaveLength(9);
    expect(sent.count).toBe(0);
    // Once Accounting is free, the intent is durable, the request is sent once and the operation succeeds.
    accounting.failIntents = false;
    await supervision.run({ analysis: 'analysis:test', environment: 'env:test', deferral: 'exit', resolution: double.factory, writer: grantingWriter, operations: { journal, accounting, random } }, (run) => run.resolve(stepOf('assess', 'pr-1'), { requestKey: 'request:last' }));
    expect(sent.count).toBe(1);
    expect(journal.operation(firstOperation)).toEqual(expect.objectContaining({ status: 'succeeded' }));
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
    expect(journal.operation(firstOperation)).toEqual(expect.objectContaining({ status: 'succeeded', attempts: [expect.objectContaining({ status: 'succeeded', usage: 'unrecorded' })] }));
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

describe('sleep-mode deferral waits (RUN-011, RUN-014)', () => {
  /** The short deferral an Accounting intent that is not durable schedules: one second after the first pass. */
  const T = T0 + 1_000;

  /** One sleep-mode run whose only operation defers once (its Accounting intent fails), with the waits it offered. */
  interface ISleepingRun {
    readonly timer: ReturnType<typeof fakeTimer>;
    readonly accounting: IMemoryAccounting;
    readonly sent: { count: number };
    readonly waits: IWaitEvent[];
    readonly done: Promise<{ readonly waitingUntil: number | undefined }>;
  }

  /** Start the run; `onWait` sees every wait event synchronously, as an observer does. */
  function sleepingRun(onWait: (event: IWaitEvent, run: ISleepingRun) => void, stop: IStopController = createStopController()): ISleepingRun {
    const journal = memoryJournal();
    const accounting = memoryAccounting();
    accounting.failIntents = true;
    const timer = fakeTimer();
    const supervision = createSupervision({ context: nodeScopes, timer });
    const sent = { count: 0 };
    const double = executing(async () => {
      await supervision.execution().operation(operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent)).catch(() => undefined);
    });
    const waits: IWaitEvent[] = [];
    const started: { run?: ISleepingRun } = {};
    const done = supervision.run({
      analysis: 'analysis:test',
      environment: 'env:test',
      runId: 'run:test',
      deferral: 'sleep',
      stop,
      resolution: double.factory,
      writer: grantingWriter,
      operations: { journal, accounting, random: countingRandom() },
      observers: [{
        observe: (event) => {
          if (event.kind === 'wait' && started.run !== undefined) {
            waits.push(event);
            onWait(event, started.run);
          }
        },
      }],
    }, (run) => run.resolve(stepOf('assess', 'pr-1'), { requestKey: 'request:1' }));
    started.run = { timer, accounting, sent, waits, done };
    return started.run;
  }

  /** Timers still able to fire and keep a host process alive: armed with keep-alive and neither fired nor cancelled. */
  function liveKeepAlive(timer: ReturnType<typeof fakeTimer>): readonly number[] {
    return timer.scheduled.filter((entry) => entry.keepAlive && !entry.cancelled && !entry.fired).map((entry) => entry.at);
  }

  test('the resumed event reports that the run released its lease for the wait, as the sleeping event did', async () => {
    const run = sleepingRun((event, self) => {
      if (event.phase === 'sleeping') {
        self.accounting.failIntents = false;
        // The sleep arms its timer in this same turn; wake it in the next.
        queueMicrotask(() => {
          self.timer.advance(1_000);
        });
      }
    });
    await run.done;
    expect(run.sent.count).toBe(1);
    expect(run.waits.map((event) => [event.phase, event.until, event.released])).toEqual([['sleeping', T, true], ['resumed', T, true]]);
  });

  test('a hard stop requested while the run offers its sleeping event ends the wait without arming the sleep timer', async () => {
    const stop = createStopController();
    const run = sleepingRun((event) => {
      if (event.phase === 'sleeping') {
        stop.request({ level: 'hard' });
      }
    }, stop);
    const result = await run.done;
    expect(result.waitingUntil).toBe(T);
    expect(run.waits.map((event) => [event.phase, event.released])).toEqual([['sleeping', true], ['stopped', true]]);
    // Nothing remains that could keep a host process alive until T.
    expect(liveKeepAlive(run.timer)).toEqual([]);
    expect(run.sent.count).toBe(0);
  });

  test('a stop requested during the sleep cancels the armed sleep timer', async () => {
    const stop = createStopController();
    const run = sleepingRun((event) => {
      if (event.phase === 'sleeping') {
        // After the sleep has armed its timer.
        queueMicrotask(() => {
          stop.request({ level: 'soft' });
        });
      }
    }, stop);
    const result = await run.done;
    expect(result.waitingUntil).toBe(T);
    expect(run.waits.map((event) => event.phase)).toEqual(['sleeping', 'stopped']);
    expect(run.timer.scheduled.filter((entry) => entry.at === T).map((entry) => entry.cancelled)).toEqual([true]);
    expect(liveKeepAlive(run.timer)).toEqual([]);
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
    expect(journal.operation(firstOperation)).toEqual(expect.objectContaining({ status: 'pending' }));
    expect(outcome.diagnostics.some((line) => line.startsWith('lease-lost:'))).toBe(true);
  });
});

describe('operator actions are run operations (CMP-9)', () => {
  test('inspecting or settling operations from inside a step attempt is refused as an undeclared call', async () => {
    const supervision = createSupervision({ context: nodeScopes, timer: fakeTimer() });
    const codes: (string | undefined)[] = [];
    let live: Parameters<Parameters<typeof supervision.run>[1]>[0] | undefined;
    const double = executing(async () => {
      if (live !== undefined) {
        codes.push(await codeOf(live.inspectOperations()), await codeOf(live.settleOperation({ action: 'abandon', operation: 'op-7-1', operator: 'operator.ada' })));
      }
    });
    await supervision.run({ analysis: 'analysis:test', environment: 'env:test', resolution: double.factory, writer: grantingWriter, operations: { journal: memoryJournal(), accounting: memoryAccounting(), random: countingRandom() } }, async (run) => {
      live = run;
      await run.resolve(stepOf('assess', 'pr-1'), { requestKey: 'request:1' });
    });
    expect(codes).toEqual(['undeclared-call', 'undeclared-call']);
  });
});

describe('records written before the intent mark existed', () => {
  test('a v1 unknown attempt remains historical through a v4 rewrite and never acquires a fabricated run instance', () => {
    const legacy = {
      format: 'microdelta.supervision.operation',
      formatVersion: 1,
      content: {
        operation: firstOperation, subject: 'assess', version: 1, member: 'pr-1', name: 'assess', binding: 'sha256:binding',
        safety: 'none', maxAttempts: 1, rateLimitRetries: 5, status: 'unknown', unrecorded: 0, notBefore: null,
        attempts: [{ requestAttempt: `${firstOperation}/1`, run: 'run:reused', stepAttempt: '3', status: 'unknown', remote: null, usage: null, intent: null }],
        settlement: null,
      },
    };
    const restored = decodeOperation(legacy);
    expect(restored.attempts[0]?.runInstance).toBeUndefined();
    const rewritten = encodeOperation(restored);
    expect(rewritten.formatVersion).toBe(4);
    expect(rewritten.content).toEqual(expect.objectContaining({ attempts: [expect.objectContaining({ runInstance: null })] }));
    expect(decodeOperation(rewritten).attempts).toEqual(restored.attempts);
    const malformed = { ...rewritten, content: { ...legacy.content, attempts: [{ ...legacy.content.attempts[0], runInstance: 7 }] } };
    expect(() => decodeOperation(malformed)).toThrow(SupervisionError);
    const missing = { ...rewritten, content: { ...legacy.content, attempts: [legacy.content.attempts[0]] } };
    expect(() => decodeOperation(missing)).toThrow(SupervisionError);
    const invalidIdentity = { ...rewritten, content: { ...legacy.content, attempts: [{ ...legacy.content.attempts[0], runInstance: 'run:public-label' }] } };
    expect(() => decodeOperation(invalidIdentity)).toThrow(SupervisionError);
  });

  test('known policy exhaustion is a v3 invocation-scoped state, not a v1/v2 or public-run-label inference', () => {
    const content = {
      operation: firstOperation, subject: 'assess', version: 1, member: 'pr-1', name: 'assess', binding: 'sha256:binding',
      safety: 'none', maxAttempts: 1, rateLimitRetries: 5, status: 'retry-exhausted', unrecorded: 0, notBefore: null,
      retryExhaustedRunInstance: 'run-instance-0123456789abcdef0123456789abcdef',
      attempts: [{ requestAttempt: `${firstOperation}/1`, run: 'run:reused', runInstance: 'run-instance-0123456789abcdef0123456789abcdef', stepAttempt: '3', status: 'failed', remote: null, usage: 'acknowledged', intent: null }],
      settlement: null,
    };
    const valid = { format: 'microdelta.supervision.operation', formatVersion: 3, content };
    expect(decodeOperation(valid)).toEqual(expect.objectContaining({ status: 'retry-exhausted', attempts: [expect.objectContaining({
      run: 'run:reused', runInstance: 'run-instance-0123456789abcdef0123456789abcdef', status: 'failed',
    })] }));
    expect(operationJournalDeclaration.formats.find((format) => format.format === 'microdelta.supervision.operation')?.versions).toEqual([1, 2, 3, 4]);

    expect(() => decodeOperation({ ...valid, formatVersion: 1 })).toThrow(SupervisionError);
    expect(() => decodeOperation({ ...valid, formatVersion: 2 })).toThrow(SupervisionError);
    expect(() => decodeOperation({ ...valid, content: { ...content, attempts: [{ ...content.attempts[0], runInstance: null }] } })).toThrow(SupervisionError);
    expect(() => decodeOperation({ ...valid, content: { ...content, attempts: [{ ...content.attempts[0], runInstance: 'run:reused' }] } })).toThrow(SupervisionError);
    expect(() => decodeOperation({ ...valid, content: { ...content, attempts: [{ ...content.attempts[0], status: 'unknown' }] } })).toThrow(SupervisionError);
  });

  test('a v2 attempt preserves private identity or an explicit upgraded-v1 null, but rejects a missing field', () => {
    const runInstance = 'run-instance-0123456789abcdef0123456789abcdef';
    const content = {
      operation: firstOperation, subject: 'assess', version: 1, member: 'pr-1', name: 'assess', binding: 'sha256:binding',
      safety: 'none', maxAttempts: 3, rateLimitRetries: 5, status: 'unknown', unrecorded: 0, notBefore: null,
      attempts: [{ requestAttempt: `${firstOperation}/1`, run: 'run:public-label', runInstance, stepAttempt: '3', status: 'unknown', remote: null, usage: 'none', intent: null }],
      settlement: null, resolution: null,
    };
    const valid = { format: 'microdelta.supervision.operation', formatVersion: 2, content };
    const restored = decodeOperation(valid);
    expect(restored.attempts[0]?.runInstance).toBe(runInstance);
    expect(decodeOperation(encodeOperation(restored)).attempts[0]?.runInstance).toBe(runInstance);
    const upgradedV1 = { ...valid, content: { ...content, attempts: [{ ...content.attempts[0], runInstance: null }] } };
    const historical = decodeOperation(upgradedV1);
    expect(historical.attempts[0]?.runInstance).toBeUndefined();
    expect(decodeOperation(encodeOperation(historical)).attempts[0]?.runInstance).toBeUndefined();
    expect(() => decodeOperation({ ...valid, content: { ...content, attempts: [{ ...content.attempts[0], runInstance: undefined }] } })).toThrow(SupervisionError);
  });

  test('v4 keeps an exhausted unknown response incomplete under the private run identity', () => {
    const runInstance = 'run-instance-0123456789abcdef0123456789abcdef';
    const record = {
      format: 'microdelta.supervision.operation', formatVersion: 4,
      content: {
        operation: firstOperation, subject: 'assess', version: 1, member: 'pr-1', name: 'assess', binding: 'sha256:binding',
        safety: 'none', maxAttempts: 1, rateLimitRetries: 5, status: 'retry-exhausted', unrecorded: 0, notBefore: null,
        previousDelayMilliseconds: null, retryExhaustedRunInstance: runInstance, classification: { kind: 'no-retry', runInstance, code: 'policy-exhausted' },
        attempts: [{ requestAttempt: `${firstOperation}/1`, run: 'run:current', runInstance, stepAttempt: '3', status: 'unknown', remote: null, usage: 'unrecorded', intent: null, decision: null }],
        settlement: null, resolution: null,
      },
    };
    expect(decodeOperation(record)).toEqual(expect.objectContaining({
      status: 'retry-exhausted',
      attempts: [expect.objectContaining({ status: 'unknown', usage: 'unrecorded' })],
    }));
  });

  test('v4 retains bounded pending classification while malformed source metadata fails integrity', () => {
    const content = {
      operation: firstOperation, subject: 'assess', version: 1, member: 'pr-1', name: 'assess', binding: 'sha256:binding',
      safety: 'none', maxAttempts: 3, rateLimitRetries: 1, status: 'pending', unrecorded: 0, notBefore: null,
      retryExhaustedRunInstance: null,
      attempts: [{ requestAttempt: `${firstOperation}/1`, run: 'run:current', runInstance: 'run-instance-0123456789abcdef0123456789abcdef', stepAttempt: '3', status: 'failed', remote: null, usage: 'none', intent: null }],
      settlement: null,
      classification: {
        kind: 'pending',
        runInstance: 'run-instance-0123456789abcdef0123456789abcdef',
        requestAttempt: `${firstOperation}/1`,
        source: { source: 'catalog', service: 'catalog-api', connection: 'org-a-read' },
        outcome: { kind: 'failed', transient: false },
        facts: { httpStatus: 404, conditions: ['resource-expected-later'] },
        generation: 'decision-1',
      },
    };
    const valid = { format: 'microdelta.supervision.operation', formatVersion: 4, content };
    const restored = decodeOperation(valid);
    expect(Reflect.get(restored, 'classification')).toEqual(content.classification);
    expect(() => decodeOperation({ ...valid, content: { ...content, classification: { ...content.classification, facts: { headers: { authorization: 'secret' } } } } })).toThrow(SupervisionError);
    for (const conditionCount of [1, 2]) {
      const conditions = new Array<string>(conditionCount);
      if (conditionCount === 2) {
        conditions[1] = 'resource-expected-later';
      }
      expect(() => decodeOperation({ ...valid, content: { ...content, classification: {
        ...content.classification, facts: { conditions },
      } } })).toThrow(SupervisionError);
    }
    for (const classification of [
      { ...content.classification, runInstance: 'run:public-label' },
      { kind: 'failed', runInstance: 'run:public-label', code: 'policy-error' },
      { kind: 'cancelled', runInstance: 'run:public-label', code: 'stopped' },
      { kind: 'no-retry', runInstance: 'run:public-label', code: 'policy-exhausted' },
    ]) {
      expect(() => decodeOperation({ ...valid, content: { ...content, classification } })).toThrow(SupervisionError);
    }
    expect(() => decodeOperation({ ...valid, content: { ...content, previousDelayMilliseconds: -1 } })).toThrow(SupervisionError);
    expect(() => decodeOperation({ ...valid, content: { ...content, attempts: [{ ...content.attempts[0], decision: { kind: 'retry-after', delayMilliseconds: -1 } }] } })).toThrow(SupervisionError);
  });

  test('a current invocation can retry a v1 unknown record even when the public runId repeats', async () => {
    const journal = memoryJournal();
    journal.put(operationsCollection, firstOperation, {
      operation: firstOperation, subject: 'assess', version: 1, member: 'pr-1', name: 'assess', binding: 'sha256:binding',
      safety: 'none', maxAttempts: 1, rateLimitRetries: 5, status: 'unknown', unrecorded: 0, notBefore: null,
      attempts: [{ requestAttempt: `${firstOperation}/1`, run: 'run:test', stepAttempt: '3', status: 'unknown', remote: null, usage: null, intent: null }],
      settlement: null,
    }, 'microdelta.supervision.operation');
    journal.put('microdelta.supervision.blocks', JSON.stringify(['assess', 1]), { subject: 'assess', version: 1, operations: [{ operation: firstOperation, name: 'assess', binding: 'sha256:binding' }] });
    const sent = { count: 0 };
    const outcome = await runOne(journal, memoryAccounting(), () => operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent));
    expect(outcome.code).toBeUndefined();
    expect(sent.count).toBe(1);
    expect(journal.operation(firstOperation)).toEqual(expect.objectContaining({ status: 'succeeded', attempts: [
      expect.objectContaining({ requestAttempt: `${firstOperation}/1`, run: 'run:test', status: 'unknown', runInstance: null }),
      expect.objectContaining({ requestAttempt: `${firstOperation}/2`, run: 'run:test', status: 'succeeded', runInstance: expect.any(String) }),
    ] }));
  });

  test('a not-sent attempt without the field is read as unconfirmed: its retry reuses it with its first attribution, keeping accounting complete', async () => {
    const journal = memoryJournal();
    const accounting = memoryAccounting();
    const requestAttempt = `${firstOperation}/1`;
    journal.put(operationsCollection, firstOperation, {
      operation: firstOperation,
      subject: 'assess',
      version: 1,
      member: 'pr-1',
      name: 'assess',
      binding: 'sha256:binding',
      safety: 'none',
      maxAttempts: 1,
      rateLimitRetries: 5,
      status: 'deferred',
      unrecorded: 1,
      notBefore: T0,
      // An attempt recorded before the `intent` field existed.
      attempts: [{ requestAttempt, run: 'run:old', stepAttempt: '3', status: 'not-sent', remote: null, usage: null }],
      settlement: null,
    }, 'microdelta.supervision.operation');
    journal.put('microdelta.supervision.blocks', JSON.stringify(['assess', 1]), { subject: 'assess', version: 1, operations: [{ operation: firstOperation, name: 'assess', binding: 'sha256:binding' }] });
    const sent = { count: 0 };
    const outcome = await runOne(journal, accounting, () => operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent));
    expect(outcome.code).toBeUndefined();
    expect(sent.count).toBe(1);
    expect(accounting.intents).toEqual([requestAttempt]);
    expect(journal.operation(firstOperation)).toEqual(expect.objectContaining({ status: 'succeeded', attempts: [expect.objectContaining({ requestAttempt, run: 'run:old', status: 'succeeded' })] }));
  });
});

describe('records written before the superseded resolution existed', () => {
  /** A resolved-as-succeeded operation record as earlier releases wrote it: no `resolution` field. */
  const resolvedRecord = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    operation: firstOperation,
    subject: 'assess',
    version: 1,
    member: 'pr-1',
    name: 'assess',
    binding: 'sha256:binding',
    safety: 'none',
    maxAttempts: 1,
    rateLimitRetries: 5,
    status: 'resolved',
    unrecorded: 0,
    notBefore: null,
    attempts: [{ requestAttempt: `${firstOperation}/1`, run: 'run:old', stepAttempt: '3', status: 'unknown', remote: null, usage: null, intent: null }],
    settlement: { action: 'resolve', outcome: 'succeeded', operator: 'operator.ada', at: T0 - 1_000, report: 'operator:invoice-1' },
    ...extra,
  });

  /** One run over a journal holding `record`, whose body runs `body` with the live run. */
  async function withRecord<T>(record: Record<string, unknown>, body: (run: IRun) => Promise<T>): Promise<T> {
    const journal = memoryJournal();
    journal.put(operationsCollection, firstOperation, record, 'microdelta.supervision.operation');
    journal.put('microdelta.supervision.blocks', JSON.stringify(['assess', 1]), { subject: 'assess', version: 1, operations: [{ operation: firstOperation, name: 'assess', binding: 'sha256:binding' }] });
    const supervision = createSupervision({ context: nodeScopes, timer: fakeTimer() });
    const double = executing(() => Promise.resolve());
    return (await supervision.run({ analysis: 'analysis:test', environment: 'env:test', resolution: double.factory, writer: grantingWriter, operations: { journal, accounting: memoryAccounting(), random: countingRandom() } }, body)).value;
  }

  test('a record without the field superseded no resolution, and abandoning it keeps its resolution as the superseded one', async () => {
    const [viewed, abandoned] = await withRecord(resolvedRecord(), async (run) => [await run.inspectOperations(), await run.settleOperation({ action: 'abandon', operation: firstOperation, operator: 'operator.ben' })] as const);
    expect(viewed.map((view) => view.resolution)).toEqual([undefined]);
    expect(abandoned).toEqual(expect.objectContaining({
      status: 'abandoned',
      settlement: { action: 'abandon', outcome: undefined, operator: 'operator.ben', at: T0, report: undefined },
      resolution: { action: 'resolve', outcome: 'succeeded', operator: 'operator.ada', at: T0 - 1_000, report: 'operator:invoice-1' },
    }));
  });

  test.each([
    ['a resolution that is not a record', 'resolve'],
    ['a resolution with an unknown action', { action: 'withdraw', outcome: 'succeeded', operator: 'operator.ada', at: T0, report: null }],
  ])('%s is integrity damage, never a guess', async (_label, resolution) => {
    expect(await withRecord(resolvedRecord({ resolution }), (run) => codeOf(run.inspectOperations()))).toBe('integrity');
  });
});

describe('malformed requests, options and records', () => {
  test('a throwing retry-source getter is a bounded request error before send', async () => {
    const journal = memoryJournal();
    const sent = { count: 0 };
    const outcome = await runOne(journal, memoryAccounting(), () => {
      const request = operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent);
      // Untyped callers can supply accessors even though the declaration is readonly.
      Object.defineProperty(request, 'retrySource', { get() { throw new Error('private request credential'); } });
      return request;
    });
    expect(outcome.code).toBe('invalid-request');
    expect(outcome.diagnostics.join(' ')).not.toContain('private request credential');
    expect(journal.commits).toBe(0);
    expect(sent.count).toBe(0);
  });

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
    expect(await codeOf(supervision.run({ ...base, operations: { journal: memoryJournal(), accounting: memoryAccounting(), random: countingRandom() } }, () => 'ran'))).toBe('invalid-request');
    const timed = createSupervision({ context: nodeScopes, timer: fakeTimer() });
    expect(await codeOf(timed.run({ ...base, operations: { journal: memoryJournal(), accounting: memoryAccounting(), random: countingRandom() } }, () => 'ran'))).not.toBe('invalid-request');
    // Operation ports need a random identifier source; the type requires it, and untyped configuration is refused at run time.
    const unrandom: IRunOptions = { ...base, operations: { journal: memoryJournal(), accounting: memoryAccounting(), random: countingRandom() } };
    Reflect.set(unrandom, 'operations', { journal: memoryJournal(), accounting: memoryAccounting() });
    expect(await codeOf(timed.run(unrandom, () => 'ran'))).toBe('invalid-request');
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
    await supervision.run({ analysis: 'analysis:test', environment: 'env:test', resolution: double.factory, writer: grantingWriter, operations: { journal, accounting: memoryAccounting(), random: countingRandom() } }, async () => {
      const failure = await Promise.resolve().then(() => double.ports().admission.admit(admissionFor(stepOf('assess', 'pr-1')))).then(() => undefined, (error: unknown) => error);
      expect(failure instanceof SupervisionError ? failure.code : failure).toBe('integrity');
    });
  });
});

/**
 * Fixed shared dispatch crosses run-local allowance and transport authority.
 * These assertions derive from #238's bounded handoff, RUN-019 and A-12e/h/k;
 * they do not claim the deferred fair-round or serial-recovery requirements.
 */
describe('fixed shared dispatch (#238)', () => {
  /** A process owner with independent, controlled epoch and duration readings. */
  function owner() {
    const timer = fakeTimer();
    let elapsed = 0;
    const elapsedClock = { currentElapsedMilliseconds: () => elapsed };
    const coordinator = createSharedRateCoordinator({ epochClock: timer, elapsedClock });
    const sharedRates = { coordinator, elapsedClock };
    const supervision = createSupervision({ context: nodeScopes, timer, ...{ sharedRates } });
    const surface = (account = 'account:a', numeric = false) => coordinator.registerSurface({
      environment: 'env:test', service: 'service:catalog', accessContext: account, surface: 'catalog',
      gates: [{ id: 'api', ...(numeric ? { limit: { units: 1, intervalMilliseconds: 100, costBasis: 'requests' as const } } : {}) }],
    });
    const random = countingRandom();
    /** Each run has separate durable state, like two stores sharing a remote account. */
    function start(request: IOperationRequest<number>, extra: Partial<IRunOptions> = {}, setup: (journal: IMemoryJournal, accounting: IMemoryAccounting) => void = () => undefined, selected: ISupervision = supervision) {
      const journal = memoryJournal();
      const accounting = memoryAccounting();
      setup(journal, accounting);
      let code: string | undefined;
      const double = executing(async () => { code = await codeOf(selected.execution().operation(request)); });
      const events: IRunEvent[] = [];
      const done = selected.run({
        analysis: 'analysis:test', environment: 'env:test', deferral: 'exit', resolution: double.factory,
        writer: grantingWriter, operations: { journal, accounting, random }, observers: [{ observe: (event) => events.push(event) }], ...extra,
      }, (run) => run.resolve(stepOf('assess', 'pr-1'), { requestKey: 'request:1' }));
      return { done, journal, accounting, events, code: () => code };
    }
    return { coordinator, sharedRates, supervision, timer, surface, start, advance(milliseconds: number): void { elapsed += milliseconds; timer.advance(milliseconds); }, setElapsed(value: number): void { elapsed = value; } };
  }

  test('two paths and new runs share a fixed gate while an independent account progresses without holding the waiting permit or intent', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface('account:a', true), cooldownGateId: 'api' };
    const sent = { count: 0 };
    await world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), ...{ sharedRate } }).done;
    const waiting = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 2 }), sent), name: 'detail', ...{ sharedRate }, retry: { maxAttempts: 1 } });
    await settle();
    expect(sent.count).toBe(1);
    expect(waiting.accounting.intents).toEqual([]);
    expect(waiting.events.filter((event) => event.kind === 'operation' && event.phase === 'request-started')).toEqual([]);
    const independent = { surface: world.surface('account:b', true), cooldownGateId: 'api' };
    const other = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 3 }), sent), ...{ sharedRate: independent } });
    await settle();
    expect(sent.count).toBe(2);
    await other.done;
    world.advance(99);
    await settle();
    expect(sent.count).toBe(2);
    world.advance(1);
    await waiting.done;
    expect(sent.count).toBe(3);
    expect(waiting.code()).toBeUndefined();
  });

  test('a known normalized cooldown is published before async classification, without numeric configuration or retrySource', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface(), cooldownGateId: 'api' };
    const sent = { count: 0 };
    const first = world.start({ ...operation(() => Promise.resolve({ kind: 'rate-limited', retryAt: T0 + 100 }), sent), ...{ sharedRate }, retry: { maxAttempts: 1 } });
    await first.done;
    const next = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 2 }), sent), ...{ sharedRate } });
    await settle();
    expect(sent.count).toBe(1);
    expect(next.accounting.intents).toEqual([]);
    world.advance(100);
    await next.done;
    expect(sent.count).toBe(2);
  });

  test('generic notBefore never becomes a shared cooldown, and an unassociated rate refusal cannot guess a surface', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface(), cooldownGateId: 'api' };
    const sent = { count: 0 };
    await world.start({ ...operation(() => Promise.resolve({ kind: 'failed', transient: true, error: 'later', notBefore: T0 + 100 }), sent), ...{ sharedRate }, retry: { maxAttempts: 1 } }).done;
    await world.start({ ...operation(() => Promise.resolve({ kind: 'rate-limited', retryAt: T0 + 200 }), sent), retry: { maxAttempts: 1 } }).done;
    await world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 2 }), sent), ...{ sharedRate } }).done;
    expect(sent.count).toBe(3);
  });

  test.each(['foreign owner', 'environment', 'gate', 'retry service', 'retry connection'] as const)('an invalid %s association fails closed before intent', async (conflict) => {
    const world = owner();
    const foreign = owner();
    const surface = conflict === 'foreign owner' ? foreign.surface() : conflict === 'environment'
      ? world.coordinator.registerSurface({ environment: 'env:other', service: 'service:catalog', accessContext: 'account:a', surface: 'catalog', gates: [{ id: 'api' }] }) : world.surface();
    const sharedRate = { surface, cooldownGateId: conflict === 'gate' ? 'unknown' : 'api' };
    const sent = { count: 0 };
    const result = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), ...{ sharedRate },
      ...(conflict === 'retry service' || conflict === 'retry connection' ? { retrySource: { source: 'adapter', service: conflict === 'retry service' ? 'service:other' : 'service:catalog', connection: conflict === 'retry connection' ? 'account:other' : 'account:a' } } : {}),
    });
    await result.done;
    expect(sent.count).toBe(0);
    expect(result.accounting.intents).toEqual([]);
    expect(result.code()).toBe('invalid-request');
  });

  test('a gate becoming blocked in the begin observer is rechecked before transport, with an unsent intent while waiting', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface('account:a', true), cooldownGateId: 'api' };
    const sent = { count: 0 };
    let blocked = false;
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), ...{ sharedRate }, retry: { maxAttempts: 1 } }, {
      observers: [{ observe(event) {
        if (!blocked && event.kind === 'send' && event.phase === 'begin') {
          blocked = true;
          world.coordinator.observeCooldown(sharedRate.surface, 'api', T0 + 100);
        }
      } }],
    });
    await settle();
    expect(sent.count).toBe(0);
    const records = call.journal.list({ analysis: 'analysis:test', environment: 'env:test', collection: operationsCollection });
    expect(records.map((row) => decodeOperation(row.record).attempts.map((attempt) => attempt.status))).toEqual([['not-sent']]);
    world.advance(100);
    await call.done;
    expect(sent.count).toBe(1);
    expect(call.code()).toBeUndefined();
  });

  test.each(['hard', 'soft'] as const)('%s stop while a retry waits prevents a later send and spends no waiting intent', async (level) => {
    const world = owner();
    const sharedRate = { surface: world.surface(), cooldownGateId: 'api' };
    world.coordinator.observeCooldown(sharedRate.surface, 'api', T0 + 100);
    const stop = createStopController();
    const sent = { count: 0 };
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), ...{ sharedRate } }, { stop });
    await settle();
    // A soft stop drains an admitted first send; hard stop withdraws it.
    stop.request({ level });
    if (level === 'soft') { world.advance(100); }
    await call.done;
    expect(sent.count).toBe(level === 'soft' ? 1 : 0);
    if (level === 'hard') { expect(call.accounting.intents).toEqual([]); }
  });

  test('possible transport failure keeps the fixed debit rather than refunding unknown remote work', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface('account:a', true), cooldownGateId: 'api' };
    const sent = { count: 0 };
    await world.start({ ...operation(() => Promise.reject(new Error('response lost')), sent), ...{ sharedRate }, retry: { maxAttempts: 1 } }).done;
    const next = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), ...{ sharedRate } });
    await settle();
    expect(sent.count).toBe(1);
    expect(next.accounting.intents).toEqual([]);
    world.advance(100);
    await next.done;
    expect(sent.count).toBe(2);
  });

  test.each(['intent', 'begin'] as const)('a synchronous hard stop at %s leaves no shared debit or provider call', async (position) => {
    const world = owner();
    const sharedRate = { surface: world.surface('account:a', true), cooldownGateId: 'api' };
    const stop = createStopController();
    const sent = { count: 0 };
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate }, {
      stop, observers: [{ observe(event) { if (position === 'begin' && event.kind === 'send' && event.phase === 'begin') { stop.request({ level: 'hard' }); } } }],
    }, (_journal, accounting) => {
      if (position === 'intent') {
        const record = accounting.recordUsageIntent.bind(accounting);
        accounting.recordUsageIntent = (intent) => { const answer = record(intent); stop.request({ level: 'hard' }); return answer; };
      }
    });
    const result = await call.done;
    expect(sent.count).toBe(0);
    expect(call.code()).toBe('stopped');
    expect(result.value).toMatchObject({ kind: 'refused' });
    expect(world.coordinator.admit({ surface: sharedRate.surface, run: 'next' }).kind).toBe('admitted');
    expect(call.journal.list({ analysis: 'analysis:test', environment: 'env:test', collection: operationsCollection }).map((row) => decodeOperation(row.record).attempts.map((attempt) => attempt.status))).toEqual([['not-sent']]);
  });

  test('a begin observer that invalidates the fence prevents provider work and successful author completion', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface('account:a', true), cooldownGateId: 'api' };
    const sent = { count: 0 };
    let journal: IMemoryJournal | undefined;
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate }, {
      observers: [{ observe(event) { if (event.kind === 'send' && event.phase === 'begin' && journal !== undefined) { journal.failFrom = journal.commits + 1; } } }],
    }, (port) => { journal = port; });
    const result = await call.done;
    expect(sent.count).toBe(0);
    expect(result.value).toMatchObject({ kind: 'refused', reason: 'unsettled' });
    expect(call.accounting.reports).toEqual([]);
    expect(world.coordinator.admit({ surface: sharedRate.surface, run: 'next' }).kind).toBe('admitted');
  });

  test('allowance changed by the begin observer is re-read before possible send', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface(), cooldownGateId: 'api' };
    const sent = { count: 0 };
    let journal: IMemoryJournal | undefined;
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate, retry: { maxAttempts: 1 } }, {
      observers: [{ observe(event) {
        if (event.kind === 'send' && event.phase === 'begin' && journal !== undefined) {
          const row = journal.list({ analysis: 'analysis:test', environment: 'env:test', collection: operationsCollection })[0];
          if (row === undefined) { throw new Error('intent missing'); }
          const record = decodeOperation(row.record);
          const pending = record.attempts.at(-1);
          if (pending === undefined) { throw new Error('request attempt missing'); }
          const changed = { ...record, attempts: [{ ...pending, requestAttempt: 'prior/1', status: 'failed' as const }, pending] };
          journal.put(operationsCollection, row.key, encodeOperation(changed).content, 'microdelta.supervision.operation', 4);
        }
      } }],
    }, (port) => { journal = port; });
    const result = await call.done;
    expect(sent.count).toBe(0);
    expect(result.value).toMatchObject({ kind: 'refused', reason: 'unsettled' });
    expect(call.accounting.reports).toEqual([]);
  });

  test('a usage intent without explicit durability confirmation cannot authorize transport', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface(), cooldownGateId: 'api' };
    const sent = { count: 0 };
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate }, {}, (_journal, accounting) => {
      Reflect.set(accounting, 'recordUsageIntent', () => undefined);
    });
    const result = await call.done;
    expect(sent.count).toBe(0);
    expect(result.value).toMatchObject({ kind: 'refused', reason: 'unsettled' });
    expect(call.accounting.reports).toEqual([]);
  });

  test('a soft-stop deadline withdraws an admitted first request before a later cooldown wake', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface(), cooldownGateId: 'api' };
    world.coordinator.observeCooldown(sharedRate.surface, 'api', T0 + 100);
    const stop = createStopController({ timer: world.timer });
    const sent = { count: 0 };
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate }, { stop });
    await settle();
    stop.request({ level: 'soft', deadline: T0 + 50 });
    world.advance(50);
    await call.done;
    world.advance(100);
    await settle();
    expect(sent.count).toBe(0);
    expect(call.accounting.intents).toEqual([]);
    expect(call.code()).toBe('stopped');
  });

  test('an early epoch wake cannot expire a monotonic window and a backward correction cannot create capacity', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface('account:a', true), cooldownGateId: 'api' };
    const sent = { count: 0 };
    await world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate }).done;
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate });
    await settle();
    world.timer.advance(1_000);
    await settle();
    expect(sent.count).toBe(1);
    expect(call.accounting.intents).toEqual([]);
    world.timer.advance(-500);
    world.setElapsed(99);
    world.timer.advance(600);
    await settle();
    expect(sent.count).toBe(1);
    world.setElapsed(100);
    world.timer.advance(1);
    await call.done;
    expect(sent.count).toBe(2);
  });

  test('a hard stop re-entering the final fenced journal callback is checked before the rate debit and transport', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface('account:a', true), cooldownGateId: 'api' };
    const stop = createStopController();
    const sent = { count: 0 };
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate }, { stop }, (journal) => {
      const commit = journal.commit.bind(journal);
      journal.commit = (lease, request) => {
        const answer = commit(lease, request);
        if (journal.commits === 2) { stop.request({ level: 'hard' }); }
        return answer;
      };
    });
    await call.done;
    expect(sent.count).toBe(0);
    expect(call.code()).toBe('stopped');
    expect(world.coordinator.admit({ surface: sharedRate.surface, run: 'next' }).kind).toBe('admitted');
  });

  test('a failed unsent restoration after a final gate refusal cannot let a catching author publish success', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface(), cooldownGateId: 'api' };
    const sent = { count: 0 };
    let journal: IMemoryJournal | undefined;
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate }, {
      observers: [{ observe(event) {
        if (event.kind === 'send' && event.phase === 'begin' && journal !== undefined) {
          world.coordinator.observeCooldown(sharedRate.surface, 'api', T0 + 100);
          journal.failFrom = journal.commits + 2;
        }
      } }],
    }, (port) => { journal = port; });
    const result = await call.done;
    expect(sent.count).toBe(0);
    expect(result.value).toMatchObject({ kind: 'refused', reason: 'unsettled' });
    expect(call.accounting.reports).toEqual([]);
  });

  test.each([undefined, 0, 1.5, 3] as const)('a quantity gate refuses missing or unsupported conservative cost %s before intent', async (quantityCost) => {
    const world = owner();
    const surface = world.coordinator.registerSurface({ environment: 'env:test', service: 'service:quantity', accessContext: 'account:a', surface: 'detail',
      gates: [{ id: 'quantity', limit: { units: 2, intervalMilliseconds: 100, costBasis: 'quantity' } }],
    });
    const sharedRate = { surface, cooldownGateId: 'quantity', ...(quantityCost === undefined ? {} : { quantityCost }) };
    const sent = { count: 0 };
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate });
    await call.done;
    expect(sent.count).toBe(0);
    expect(call.accounting.intents).toEqual([]);
    expect(call.code()).toBe('invalid-request');
  });

  test('no retryAt means no invented shared cooldown, even if a generic local floor exists', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface(), cooldownGateId: 'api' };
    const sent = { count: 0 };
    await world.start({ ...operation(() => Promise.resolve({ kind: 'rate-limited', notBefore: T0 + 100 }), sent), sharedRate, retry: { maxAttempts: 1 } }).done;
    expect(world.coordinator.admit({ surface: sharedRate.surface, run: 'another-path' }).kind).toBe('admitted');
  });

  test('a continuing operation address cannot change its explicit association within one run', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface(), cooldownGateId: 'api' };
    const other = { surface: world.surface('account:b'), cooldownGateId: 'api' };
    const sent = { count: 0 };
    let changed: string | undefined;
    const double = executing(async () => {
      const request = { ...operation(() => Promise.resolve({ kind: 'failed' as const, transient: false, error: 'permanent' }), sent), sharedRate };
      await codeOf(world.supervision.execution().operation(request));
      changed = await codeOf(world.supervision.execution().operation({ ...request, sharedRate: other }));
    });
    await world.supervision.run({ analysis: 'analysis:test', environment: 'env:test', deferral: 'exit', resolution: double.factory, writer: grantingWriter,
      operations: { journal: memoryJournal(), accounting: memoryAccounting(), random: countingRandom() },
    }, (run) => run.resolve(stepOf('assess', 'pr-1'), { requestKey: 'association-test' }));
    expect(changed).toBe('invalid-request');
    expect(sent.count).toBe(1);
  });

  test('independent supervisors share admission only when explicitly composed with the same coordinator owner', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface('account:a', true), cooldownGateId: 'api' };
    const sent = { count: 0 };
    await world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate }).done;
    const peer = createSupervision({ context: nodeScopes, timer: world.timer, sharedRates: world.sharedRates });
    const next = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate }, {}, () => undefined, peer);
    await settle();
    expect(sent.count).toBe(1);
    expect(next.accounting.intents).toEqual([]);
    world.advance(100);
    await next.done;
    expect(sent.count).toBe(2);
    const unowned = createSupervision({ context: nodeScopes, timer: world.timer });
    const refused = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate }, {}, () => undefined, unowned);
    await refused.done;
    expect(refused.code()).toBe('invalid-request');
    expect(sent.count).toBe(2);
  });

  test.each(['negative', 'decreasing', 'throwing'] as const)('a %s clock failure retains its typed dispatch error, redacts host detail and spends no intent or rate debit', async (failure) => {
    const world = owner();
    const sharedRate = { surface: world.surface('account:a', true), cooldownGateId: 'api' };
    if (failure === 'decreasing') {
      world.setElapsed(10);
      world.coordinator.admit({ surface: sharedRate.surface, run: 'preview' });
      world.setElapsed(9);
    } else if (failure === 'throwing') {
      Reflect.set(world.sharedRates.elapsedClock, 'currentElapsedMilliseconds', () => { throw new Error('PRIVATE-CLOCK-DETAIL'); });
    } else { world.setElapsed(-1); }
    const sent = { count: 0 };
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate });
    const result = await call.done;
    expect(call.code()).toBe('rate-timing-failed');
    expect(sent.count).toBe(0);
    expect(call.accounting.intents).toEqual([]);
    expect(_inspectSharedRateDebits(world.coordinator, sharedRate.surface, 'api')).toEqual([]);
    expect(JSON.stringify({ result, events: call.events })).not.toContain('PRIVATE-CLOCK-DETAIL');
  });

  test('a clock failure after durable intent preserves the typed failure and records a definite unsent attempt', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface('account:a', true), cooldownGateId: 'api' };
    const sent = { count: 0 };
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate }, {
      observers: [{ observe(event) { if (event.kind === 'send' && event.phase === 'begin') { world.setElapsed(-1); } } }],
    });
    const result = await call.done;
    expect(call.code()).toBe('rate-timing-failed');
    expect(sent.count).toBe(0);
    expect(call.accounting.intents).toHaveLength(1);
    expect(call.accounting.reports).toEqual([]);
    expect(_inspectSharedRateDebits(world.coordinator, sharedRate.surface, 'api')).toEqual([]);
    expect(call.journal.list({ analysis: 'analysis:test', environment: 'env:test', collection: operationsCollection }).map((row) => decodeOperation(row.record).attempts.map((attempt) => attempt.status))).toEqual([['not-sent']]);
    expect(result.value).toMatchObject({ kind: 'refused', reason: 'interrupted' });
  });

  test('assembly configuration mutation cannot replace the coordinator owner between its runs', async () => {
    const world = owner();
    const sharedRate = { surface: world.surface('account:a', true), cooldownGateId: 'api' };
    const sent = { count: 0 };
    await world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate }).done;
    world.sharedRates.coordinator = owner().coordinator;
    const call = world.start({ ...operation(() => Promise.resolve({ kind: 'succeeded', value: 1 }), sent), sharedRate });
    await settle();
    expect(sent.count).toBe(1);
    expect(call.code()).toBeUndefined();
    expect(call.accounting.intents).toEqual([]);
    world.advance(100);
    await call.done;
    expect(sent.count).toBe(2);
  });

});
