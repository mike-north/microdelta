/**
 * EXP-8 in-process harness shared by the single-process suites: wires one
 * pass over the fakes, and offers small event and scheduling helpers. It adds
 * no behavior of its own.
 */
import { Permits, StopController, Store, runPass } from '../src/protocol.js';
import type {
  IDrainUnit,
  IEvent,
  IEventKind,
  IMemberDeclaration,
  IObserver,
  IProviderRequest,
  IRemoteCancel,
  IRunReport,
  IWaitMode,
} from '../src/protocol.js';
import { FakeClock, FakeProvider, HOUR, MemoryPort, T0, baseScript, emptyLedger, leaseTtlMs } from './fakes.js';
import type { ILedger, IScript } from './fakes.js';

/** Everything one in-process pass needs; omitted parts get fresh defaults. */
export interface ISetup {
  readonly members: readonly IMemberDeclaration[];
  readonly script?: IScript;
  readonly port?: MemoryPort;
  readonly clock?: FakeClock;
  readonly ledger?: ILedger;
  readonly stop?: StopController;
  readonly observers?: readonly IObserver[];
  readonly permits?: Permits;
  readonly maxActive?: number;
  readonly waitMode?: IWaitMode;
  readonly drainUnit?: IDrainUnit;
  readonly idempotencyKeys?: boolean;
  readonly cancelAnswer?: IRemoteCancel | 'unsupported' | 'no-answer';
  /** The operator-configured lease TTL; it should exceed the longest expected request. */
  readonly leaseTtlMs?: number;
  readonly onReceive?: (request: IProviderRequest, index: number, harness: IHarness) => void;
}

/** The live parts of one pass, for scripted operator actions and later inspection. */
export interface IHarness {
  readonly port: MemoryPort;
  readonly clock: FakeClock;
  readonly stop: StopController;
  readonly provider: FakeProvider;
  readonly permits: Permits;
  readonly run: () => Promise<IRunReport>;
}

/** Wire a pass over fakes. Nothing runs until `run` is called. */
export function prepare(setup: ISetup): IHarness {
  const port = setup.port ?? new MemoryPort();
  const clock = setup.clock ?? new FakeClock(T0);
  const stop = setup.stop ?? new StopController();
  const permits = setup.permits ?? new Permits(2);
  // The provider's receipt hook needs the finished harness; it is filled in below.
  const live: { harness?: IHarness } = {};
  const provider = new FakeProvider(setup.script ?? baseScript(), {
    clock,
    ledger: setup.ledger ?? emptyLedger(),
    ...(setup.idempotencyKeys === undefined ? {} : { idempotencyKeys: setup.idempotencyKeys }),
    ...(setup.cancelAnswer === undefined ? {} : { cancelAnswer: setup.cancelAnswer }),
    onReceive: (request, index) => {
      if (live.harness !== undefined) {
        setup.onReceive?.(request, index, live.harness);
      }
    },
  });
  const store = new Store(port, setup.leaseTtlMs ?? leaseTtlMs);
  const harness: IHarness = {
    port,
    clock,
    stop,
    provider,
    permits,
    run: () => runPass({
      store,
      clock,
      provider,
      members: setup.members,
      stop,
      permits,
      ...(setup.observers === undefined ? {} : { observers: setup.observers }),
      ...(setup.maxActive === undefined ? {} : { maxActive: setup.maxActive }),
      ...(setup.waitMode === undefined ? {} : { waitMode: setup.waitMode }),
      ...(setup.drainUnit === undefined ? {} : { drainUnit: setup.drainUnit }),
    }),
  };
  live.harness = harness;
  return harness;
}

/** A time after every in-process pass, when no pass holds the lease. */
export const afterRuns = T0 + 24 * HOUR;

/** Run an operator action after the current provider call has returned its promise. */
export function later(action: () => void): void {
  void Promise.resolve().then(action);
}

/** Events of one kind, optionally for one member. */
export function eventsOf(report: IRunReport, kind: IEventKind, member?: string): readonly IEvent[] {
  return report.events.filter(event => event.kind === kind && (member === undefined || event.member === member));
}

/** The kinds of the events, in order. */
export function kindsOf(events: readonly IEvent[]): readonly IEventKind[] {
  return events.map(event => event.kind);
}

/** Let queued microtasks and one macrotask turn run, to observe what happened "at once". */
export async function flush(turns = 1): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
  }
}
