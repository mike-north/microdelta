/**
 * Assembly support for Reuse Resolution tests. A "session" stands in for one
 * process lifetime: it opens History's real durable SQLite authority over a
 * file (through Node's real SQLite capability, observed but never replaced),
 * builds a fresh composition, a fresh Tracking observer and a fresh
 * Resolution, and holds the single writer lease. Closing a session releases
 * the lease and closes the file, so the next session reopens the same store
 * with nothing surviving but durable History. Independent-process proof of
 * the assembled authoring path belongs to the later acceptance harness; these
 * sessions prove Resolution's contract over real History within one process.
 *
 * @see ../../../../docs/plans/m3-contribution-analysis.md
 */
import type { IBindingDescriptor } from '@microdelta/definition';
import type { IDurableHistory, IWriterLease } from '@microdelta/history';
import { createNodeMachine } from '@microdelta/machine-node';
import { createResolution } from '@microdelta/resolution';
import type {
  IAdmissionDecision,
  IAdmissionRequest,
  ILifecycleEvent,
  IResolution,
  IResolutionOutcome,
} from '@microdelta/resolution';
import { createTrackingObserver } from '@microdelta/tracking';

import { controlledClock, observedSqlite, openHistory } from '../durable-history/support.js';
import type { IObservedSqlite } from '../durable-history/support.js';
import { bindingSlots, composeContributors } from './fixture.js';
import type { IContributors, IMemberKey, IVariation } from './fixture.js';

/** History's environment for every session. */
export const environment = 'env:fixture';

/** Admission behavior for one session: admit everything, or deny chosen steps. */
export interface IAdmissionPlan {
  /** Deny work for any step whose slot and member match. */
  readonly deny?: readonly { readonly memberKey: IMemberKey; readonly slot: string }[];
  /** Throw from the admission port instead of deciding. */
  readonly fail?: boolean;
}

/** Observer behavior for one session. */
export interface IObserverPlan {
  /** Throw when an event with this phase is observed. */
  readonly throwAt?: ILifecycleEvent['phase'];
}

/** One simulated process lifetime over a durable store. */
export interface ISession {
  readonly history: IDurableHistory;
  readonly sqlite: IObservedSqlite;
  readonly contributors: IContributors;
  readonly resolution: IResolution;
  readonly lease: IWriterLease;
  /** Every admission request presented in this session, in order. */
  readonly admissions: IAdmissionRequest[];
  /** Every observed lifecycle event in this session, in order. */
  readonly events: ILifecycleEvent[];
  /** Resolve one step with a fresh request key. */
  resolve(step: IBindingDescriptor, requestKey?: string): Promise<IResolutionOutcome>;
  /** Release the lease and close the store. */
  close(): void;
}

/** Monotonic request-key counter; each normal request uses a fresh key unless a test supplies one. */
let requestCounter = 0;

/** A fresh opaque request key. */
export function freshRequestKey(): string {
  requestCounter += 1;
  return `request:${String(requestCounter)}`;
}

/** One shared controlled clock so leases never expire during a test unless a test advances it. */
const clock = controlledClock(1_000);
let clockReading = 1_000;

/**
 * Advance the shared clock, for example past a session's lease so History
 * refuses that session's later writes as stale. Readings only move forward.
 */
export function advanceClock(milliseconds: number): void {
  clockReading += milliseconds;
  clock.set(clockReading);
}

/** The lease duration every session acquires. */
export const leaseMilliseconds = 3_600_000;

/** Open a session over the store at `location`. */
export function openSession(location: string, variation: IVariation = {}, plans: { readonly admission?: IAdmissionPlan; readonly observer?: IObserverPlan } = {}): ISession {
  const sqlite = observedSqlite();
  const history = openHistory({ location, sqlite: sqlite.capability, clock });
  const acquisition = history.acquireWriter({ holder: `session:${String(requestCounter)}`, leaseMilliseconds });
  if (acquisition.kind !== 'acquired') {
    throw new Error(`expected the writer lease, observed ${JSON.stringify(acquisition)}`);
  }
  const lease = acquisition.lease;
  const machine = createNodeMachine();
  const contributors = composeContributors(variation);
  const admissions: IAdmissionRequest[] = [];
  const events: ILifecycleEvent[] = [];
  const resolution = createResolution({
    declarations: contributors.builders,
    composition: contributors.composition,
    bindings: bindingSlots,
    environment,
    history,
    tracking: createTrackingObserver(machine),
    host: machine,
    admission: {
      admit(request: IAdmissionRequest): IAdmissionDecision {
        admissions.push(request);
        if (plans.admission?.fail === true) {
          throw new Error('admission service unavailable');
        }
        const denied = plans.admission?.deny?.some((rule) => rule.memberKey === request.step.memberKey && rule.slot === request.step.slot) === true;
        return denied ? { kind: 'denied', reason: 'fixture budget exhausted' } : { kind: 'admitted' };
      },
    },
    observer: {
      observe(event: ILifecycleEvent): void {
        events.push(event);
        if (plans.observer?.throwAt === event.phase) {
          throw new Error(`observer failure at ${event.phase}`);
        }
      },
    },
  });
  let closed = false;
  return {
    history,
    sqlite,
    contributors,
    resolution,
    lease,
    admissions,
    events,
    resolve: (step, requestKey) => resolution.resolve({ step, requestKey: requestKey ?? freshRequestKey(), lease }),
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      try {
        history.releaseWriter(lease);
      } catch {
        // A test that expired this lease on purpose cannot release it; the successor acquires anyway.
      }
      history.close();
    },
  };
}

/** Resolve both summaries in the composition's member order and return them keyed by member. */
export async function resolveSummaries(session: ISession, order: readonly IMemberKey[] = ['person:ada', 'person:ben']): Promise<Record<IMemberKey, IResolutionOutcome>> {
  const outcomes: Partial<Record<IMemberKey, IResolutionOutcome>> = {};
  for (const key of order) {
    outcomes[key] = await session.resolve(session.contributors.steps[key].summary);
  }
  const ada = outcomes['person:ada'];
  const ben = outcomes['person:ben'];
  if (ada === undefined || ben === undefined) {
    throw new Error('both summaries must resolve');
  }
  return { 'person:ada': ada, 'person:ben': ben };
}

/** The exact reference of an outcome that produced or reused a result. */
export function referenceOf(outcome: IResolutionOutcome): string {
  if (outcome.kind === 'refused') {
    throw new Error(`expected a result, observed refusal of ${JSON.stringify(outcome.refused)}: ${outcome.reason}`);
  }
  if (outcome.kind === 'skipped') {
    throw new Error('expected a result, observed a gated-out skip');
  }
  return outcome.reference.locator;
}

/** The stored summary payload of an exact reference, read through History's exact subtree reader. */
export function payloadOf(history: IDurableHistory, locator: string): unknown {
  return history.reader.readSubtree({ kind: 'completed-result', locator }, []);
}
