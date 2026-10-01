/**
 * Assembly of the real owner packages for the external-operation suites. A
 * session stands in for one process lifetime: History's durable authority
 * and its operation journal over one SQLite file, Resource Accounting's
 * durable adapter over another, Run Supervision over Node's asynchronous
 * context and a controlled timer, and Reuse Resolution over the fixture
 * composition. Nothing here replaces an owner: the harness only wires the
 * ports exactly as assembly would, supplies a controlled clock for
 * Supervision's deferral times, and records the events a run offers.
 *
 * These suites assemble Supervision directly because they need a controlled
 * clock, which the facade's Node timer does not offer; the facade's own
 * assembly of the same ports is exercised in `test/workspace-operations`.
 * Accounting is a development dependency of the facade package: tests inject
 * its durable adapter, and the facade itself never imports it.
 *
 * @see ../../../../docs/spec/operations.md (RUN-011 to RUN-017, ACC-003, ACC-005, ACC-007)
 * @see ../../../../experiments/exp-8/decision.md
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDurableAccounting } from '@microdelta/accounting';
import type { IDurableAccounting, IDurableAccountingOptions, IUsageSummary } from '@microdelta/accounting';
import { openDurableHistory } from '@microdelta/history';
import type { IDurableHistory, IOperationJournal } from '@microdelta/history';
import { createNodeMachine, createNodeRandom, createNodeSqlite } from '@microdelta/machine-node';
import { createResolution } from '@microdelta/resolution';
import type { IResolutionHistory } from '@microdelta/resolution';
import { createSupervision, operationJournalDeclaration } from '@microdelta/supervision';
import type { IDeferralMode, IOperationAccounting, IRunRandom, IRun, IRunEvent, IRunResult, IRunTimer, IStopController, ISupervision, IWriterWaitOptions } from '@microdelta/supervision';
import { createTrackingObserver } from '@microdelta/tracking';

import { writerFor } from '../../src/writer.js';
import { composeOperations, useSupervision } from './fixture.js';
import type { IOperationsFixture } from './fixture.js';

/** The Machine SQLite capability as Accounting's adapter receives it. */
export type ISqliteCapability = IDurableAccountingOptions['sqlite'];

/** The Node host every session shares. */
export const machine = createNodeMachine();

/** The logical store of every operations-suite store. */
export const logicalStore = 'store:operations';

/** The production environment. */
export const production = 'env:production';

/** A trial environment of the same analysis. */
export const trial = 'env:trial';

/** A fixed wall-clock origin for Supervision's timer: 2026-01-01T00:00:00Z. */
export const T0 = Date.UTC(2026, 0, 1);

/** One hour in milliseconds. */
export const hour = 60 * 60 * 1_000;

/** A controlled timer: time moves only when advanced, and due callbacks run in time order. */
export interface IFakeTimer extends IRunTimer {
  /** Callbacks scheduled and neither fired nor cancelled. */
  pending(): readonly number[];
  /** Move the clock forward to `epochMilliseconds`, running every callback that falls due. */
  advanceTo(epochMilliseconds: number): void;
}

/** Create a controlled timer starting at `start`. */
export function fakeTimer(start: number = T0): IFakeTimer {
  let now = start;
  const entries: { readonly at: number; readonly callback: () => void; done: boolean }[] = [];
  return {
    currentEpochMilliseconds: () => now,
    schedule(epochMilliseconds, callback): () => void {
      const entry = { at: epochMilliseconds, callback, done: false };
      entries.push(entry);
      return () => {
        entry.done = true;
      };
    },
    pending: () => entries.filter((entry) => !entry.done).map((entry) => entry.at),
    advanceTo(epochMilliseconds: number): void {
      for (;;) {
        const due = entries.filter((entry) => !entry.done && entry.at <= epochMilliseconds).sort((left, right) => left.at - right.at)[0];
        if (due === undefined) {
          break;
        }
        now = Math.max(now, due.at);
        due.done = true;
        due.callback();
      }
      now = Math.max(now, epochMilliseconds);
    },
  };
}

/** The files one test's stores live in. */
export interface IOperationStores {
  readonly history: string;
  readonly accounting: string;
  readonly ledger: string;
  remove(): void;
}

/** Create a temporary directory holding a History store, an Accounting store and a provider ledger. */
export function tempStores(): IOperationStores {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-operations-'));
  return {
    history: join(directory, 'history.sqlite'),
    accounting: join(directory, 'accounting.sqlite'),
    ledger: join(directory, 'provider.jsonl'),
    remove: () => rmSync(directory, { recursive: true, force: true }),
  };
}

/** Run options a test chooses. */
export interface IOperationRunOptions {
  /** The run's environment; production when absent. */
  readonly environment?: string;
  /** The run identifier; generated when absent. */
  readonly runId?: string;
  readonly deferral?: IDeferralMode;
  readonly stop?: IStopController;
  readonly permits?: number;
  readonly window?: number;
  /** The run's policy for waiting on the writer lease. */
  readonly writerWait?: IWriterWaitOptions;
  /** False to run without operation ports. */
  readonly operations?: boolean;
  /** Also offered every run event, synchronously and after the session records it, as any run observer is. */
  readonly observe?: (event: IRunEvent) => void;
}

/** A started run with the events it offered so far. */
export interface IStartedRun<T> {
  readonly events: IRunEvent[];
  readonly done: Promise<IRunResult<T>>;
}

/** One simulated process lifetime over the stores. */
export interface IOperationSession {
  readonly timer: IFakeTimer;
  readonly supervision: ISupervision;
  readonly history: IDurableHistory;
  readonly journal: IOperationJournal;
  readonly accounting: IDurableAccounting;
  readonly fixture: IOperationsFixture;
  /** Start one run; its result promise is already marked handled. */
  start<T>(options: IOperationRunOptions, body: (run: IRun) => Promise<T>): IStartedRun<T>;
  /** Accounting's summary of one environment. */
  usage(environment?: string): IUsageSummary;
  close(): void;
}

/** Monotonic counter of fresh request keys and generated run identifiers. */
let counter = 0;

/** A fresh opaque request key. */
export function freshKey(): { readonly requestKey: string } {
  counter += 1;
  return { requestKey: `ops-request:${String(counter)}` };
}


/** Options of a session. */
export interface ISessionOptions {
  /** The writer lease duration on the controlled clock; one day when absent. */
  readonly leaseMilliseconds?: number;
  /** Wrap the Accounting port Supervision receives, for fault injection around the real adapter. */
  readonly wrapAccounting?: (accounting: IOperationAccounting) => IOperationAccounting;
  /** Wrap the History port Resolution receives, to present damaged evidence at the port boundary. */
  readonly wrapHistory?: (history: IDurableHistory) => IResolutionHistory;
  /** The SQLite capability Accounting's adapter opens its file with; Node's real one when absent. */
  readonly accountingSqlite?: ISqliteCapability;
  /** The random identifier source of the operation ports; Node's secure one when absent. */
  readonly random?: IRunRandom;
}

/** Open a session over `stores`, with Supervision's clock at `timer`. */
export function openSession(stores: Pick<IOperationStores, 'history' | 'accounting'>, timer: IFakeTimer, options: ISessionOptions = {}): IOperationSession {
  // History's lease clock and Supervision's deferral clock are one controlled clock, so lease expiry across processes needs no real waiting.
  const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: { currentEpochMilliseconds: () => timer.currentEpochMilliseconds() }, sha256: machine, location: stores.history, logicalStore });
  const accounting = openDurableAccounting({ sqlite: options.accountingSqlite ?? createNodeSqlite(), location: stores.accounting, logicalStore });
  const journal = history.openJournal(operationJournalDeclaration);
  const supervision = createSupervision({ context: machine, timer });
  const random = options.random ?? createNodeRandom();
  const fixture = composeOperations();
  useSupervision(supervision);
  const leaseMilliseconds = options.leaseMilliseconds ?? 24 * hour;
  return {
    timer,
    supervision,
    history,
    journal,
    accounting,
    fixture,
    start<T>(runOptions: IOperationRunOptions, body: (run: IRun) => Promise<T>): IStartedRun<T> {
      counter += 1;
      const runId = runOptions.runId ?? `run:${String(counter)}`;
      const environment = runOptions.environment ?? production;
      const events: IRunEvent[] = [];
      const done = supervision.run({
        analysis: fixture.composition.scope,
        environment,
        runId,
        writer: writerFor(history, `ops:${runId}`, leaseMilliseconds),
        observers: [{
          observe: (event) => {
            events.push(event);
            runOptions.observe?.(event);
          },
        }],
        ...(runOptions.operations === false ? {} : { operations: { journal, accounting: options.wrapAccounting?.(accounting) ?? accounting, random } }),
        ...(runOptions.deferral === undefined ? {} : { deferral: runOptions.deferral }),
        ...(runOptions.stop === undefined ? {} : { stop: runOptions.stop }),
        ...(runOptions.permits === undefined ? {} : { permits: runOptions.permits }),
        ...(runOptions.window === undefined ? {} : { window: runOptions.window }),
        ...(runOptions.writerWait === undefined ? {} : { writerWait: runOptions.writerWait }),
        resolution: (ports) => createResolution({
          declarations: fixture.builders,
          composition: fixture.composition,
          bindings: { inputs: fixture.composition.topology.inputs, helpers: fixture.composition.topology.helpers },
          environment,
          history: options.wrapHistory?.(history) ?? history,
          tracking: createTrackingObserver(machine),
          host: machine,
          admission: ports.admission,
          observer: ports.observer,
          execution: ports.execution,
        }),
      }, body);
      done.catch(() => undefined);
      return { events, done };
    },
    usage: (environment = production) => accounting.summarizeUsage({ environment }),
    close(): void {
      accounting.close();
      history.close();
    },
  };
}

/** Each member's status in a members report, by key. */
export function statuses(members: readonly { readonly key: string; readonly status: string }[]): Readonly<Record<string, string>> {
  return Object.fromEntries(members.map((member) => [member.key, member.status]));
}

/** The operation events a run offered, as compact `phase:status:reason` strings per operation name and member. */
export function operationTrace(events: readonly IRunEvent[]): string[] {
  return events.flatMap((event) => event.kind === 'operation'
    ? [`${event.name}@${event.member ?? '-'}:${event.phase}${event.status === undefined ? '' : `:${event.status}`}${event.reason === undefined ? '' : `:${event.reason}`}`]
    : []);
}

/**
 * Wait, one event-loop turn at a time, until `condition` holds. Fails with
 * `description` after a bounded number of turns rather than hanging.
 */
export async function until(condition: () => boolean, description: string, turns = 5_000): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
  throw new Error(`timed out waiting until ${description}`);
}
