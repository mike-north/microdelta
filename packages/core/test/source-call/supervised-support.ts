/**
 * Controlled-clock assembly of real owners for source acquisition. The facade
 * fixture supplies declarations; Supervision owns admission, sends and stop;
 * History and Accounting keep their real durable authorities. Only the remote
 * adapter and time are controlled. No second transport or persistence path exists.
 */
import { join } from 'node:path';
import { openDurableAccounting } from '@microdelta/accounting';
import type { IDurableAccounting, IDurableAccountingOptions } from '@microdelta/accounting';
import { openDurableHistory } from '@microdelta/history';
import type { IDurableHistory, IOperationJournal } from '@microdelta/history';
import { createNodeMachine, createNodeRandom, createNodeSqlite } from '@microdelta/machine-node';
import { createResolution } from '@microdelta/resolution';
import { createStopController, createSupervision, operationJournalDeclaration, operationsCollection } from '@microdelta/supervision';
import type { IFoldReport, IOperationView, IRunEvent, IRunResult, IStopController } from '@microdelta/supervision';
import { createTrackingObserver } from '@microdelta/tracking';
import { writerFor } from '../../src/writer.js';
import { fakeTimer } from '../operations/harness.js';
import type { IFakeTimer } from '../operations/harness.js';
import { fakeProvider } from '../operations/provider.js';
import type { IFakeProvider } from '../operations/provider.js';
import { composeFixture, installAcquisition, logicalStore, scope } from './fixture.js';

/** Every started run records offered events separately from eventual completion. */
export interface IStarted {
  readonly done: Promise<IRunResult<{ readonly report: IFoldReport; readonly operations: readonly IOperationView[] }>>;
  readonly events: IRunEvent[];
}
/** A real supervised source-call session over controlled external responses and time. */
export interface ISession {
  readonly timer: IFakeTimer;
  readonly history: IDurableHistory;
  readonly accounting: IDurableAccounting;
  readonly journal: IOperationJournal;
  readonly provider: IFakeProvider;
  readonly location: string;
  stop(): IStopController;
  start(options?: { readonly stop?: IStopController; readonly deferral?: 'sleep' | 'exit'; readonly observe?: (event: IRunEvent) => void; readonly maxAttempts?: number; readonly backoffMilliseconds?: number }): IStarted;
  contents(): readonly unknown[];
  close(): void;
}
/** Each source attempt receives a distinct saved top-level request identity. */
let requests = 0;
/** Open the same owner graph production assembly uses, with a deterministic timer. */
export function session(directory: string, options: { readonly accountingSqlite?: IDurableAccountingOptions['sqlite']; readonly leaseMilliseconds?: number } = {}): ISession {
  const timer = fakeTimer();
  const machine = createNodeMachine();
  const location = join(directory, 'history.sqlite');
  const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: timer, sha256: machine, location, logicalStore });
  const accounting = openDurableAccounting({ sqlite: options.accountingSqlite ?? createNodeSqlite(), location: join(directory, 'accounting.sqlite'), logicalStore });
  const journal = history.openJournal(operationJournalDeclaration);
  const supervision = createSupervision({ context: machine, timer });
  const provider = fakeProvider(() => timer.currentEpochMilliseconds());
  const fixture = composeFixture();
  const random = createNodeRandom();
  let retry = { maxAttempts: 1, backoffMilliseconds: 10 };
  installAcquisition((id, argument, policy, detail) => supervision.execution().operation({
    name: 'detail', binding: `sha256:detail:${id}:${argument}:${policy}`, retry,
    perform: async send => {
      const response = await provider.perform('detail', id, send);
      return response.kind === 'succeeded' ? { ...response, value: { ...detail } } : response;
    },
  }));
  return {
    timer, history, accounting, journal, provider, location,
    stop: () => createStopController({ timer }),
    start(runOptions = {}) {
      requests += 1;
      const runId = `source-call-run:${String(requests)}`;
      const requestKey = `supervised-source-call:${String(requests)}`;
      retry = { maxAttempts: runOptions.maxAttempts ?? 1, backoffMilliseconds: runOptions.backoffMilliseconds ?? 10 };
      const events: IRunEvent[] = [];
      const done = supervision.run({ analysis: scope, environment: 'production', runId,
        writer: writerFor(history, runId, options.leaseMilliseconds ?? 60_000),
        permits: 2, window: 2,
        observers: [{ observe: event => { events.push(event); runOptions.observe?.(event); } }],
        operations: { journal, accounting, random },
        deferral: runOptions.deferral ?? 'exit',
        ...(runOptions.stop === undefined ? {} : { stop: runOptions.stop }),
        resolution: ports => createResolution({ declarations: fixture.authoring, composition: fixture.composition, bindings: { inputs: fixture.composition.topology.inputs, helpers: fixture.composition.topology.helpers }, environment: 'production', history, tracking: createTrackingObserver(machine), host: machine, admission: ports.admission, observer: ports.observer, execution: ports.execution }),
      }, async run => ({ report: await run.resolveFold(fixture.report, { requestKey }), operations: await run.inspectOperations() }));
      void done.catch(() => undefined);
      return { done, events };
    },
    contents: () => journal.list({ analysis: scope, environment: 'production', collection: operationsCollection }).map(entry => entry.record.content),
    close: () => { installAcquisition(undefined); history.close(); accounting.close(); },
  };
}
