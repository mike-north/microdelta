/**
 * Assembly support for nested-validation tests. A session stands in for one
 * process lifetime over a durable SQLite History file: a fresh composition,
 * Tracking observer and Resolution, and the single writer lease. The same
 * session code runs inside the separate worker processes of the restart
 * suite, so in-process and cross-process evidence use one assembly.
 *
 * @see ../../../../docs/plans/m4-composition.md ("Nested invocation evidence")
 */
import type { IBindingDescriptor } from '@microdelta/definition';
import type { IDurableHistory, IWriterLease } from '@microdelta/history';
import { createNodeMachine } from '@microdelta/machine-node';
import { createResolution } from '@microdelta/resolution';
import type { IAdmissionRequest, ICheckOutcome, ILifecycleEvent, IResolution, IResolutionOutcome } from '@microdelta/resolution';
import { createTrackingObserver } from '@microdelta/tracking';

import { controlledClock, openHistory } from '../durable-history/support.js';
import { bindingSlots, composeNested, memberKeys } from './fixture.js';
import type { IMemberKey, INested, IVariation } from './fixture.js';

/** History's environment for every nested session. */
export const environment = 'env:nested';

/** The logical store every nested session uses. */
export const logicalStore = 'store:nested';

/** One simulated process lifetime over a durable store. */
export interface INestedSession {
  readonly history: IDurableHistory;
  readonly nested: INested;
  readonly resolution: IResolution;
  readonly lease: IWriterLease;
  /** Every admission request presented in this session, in order. */
  readonly admissions: IAdmissionRequest[];
  /** Every observed lifecycle event in this session, in order. */
  readonly events: ILifecycleEvent[];
  /** Resolve one step with a fresh request key. */
  resolve(step: IBindingDescriptor): Promise<IResolutionOutcome>;
  /** Check one step without admission, claims, bodies or writes. */
  check(step: IBindingDescriptor): Promise<ICheckOutcome>;
  /** Release the lease and close the store. */
  close(): void;
}

/** Monotonic request-key counter. */
let requestCounter = 0;

/** A clock that never lets a session's lease expire during a test. */
const clock = controlledClock(1_000);

/** Open a session over the store at `location`. */
export function openNestedSession(location: string, variation: IVariation = {}): INestedSession {
  const history = openHistory({ location, clock, store: logicalStore });
  requestCounter += 1;
  const acquisition = history.acquireWriter({ holder: `nested:${String(requestCounter)}`, leaseMilliseconds: 3_600_000 });
  if (acquisition.kind !== 'acquired') {
    throw new Error(`expected the writer lease, observed ${JSON.stringify(acquisition)}`);
  }
  const lease = acquisition.lease;
  const machine = createNodeMachine();
  const nested = composeNested(variation);
  const admissions: IAdmissionRequest[] = [];
  const events: ILifecycleEvent[] = [];
  const resolution = createResolution({
    declarations: nested.builders,
    composition: nested.composition,
    bindings: bindingSlots,
    environment,
    history,
    tracking: createTrackingObserver(machine),
    host: machine,
    admission: {
      admit(request) {
        admissions.push(request);
        return { kind: 'admitted' };
      },
    },
    observer: {
      observe(event) {
        events.push(event);
      },
    },
  });
  let closed = false;
  return {
    history,
    nested,
    resolution,
    lease,
    admissions,
    events,
    resolve(step) {
      requestCounter += 1;
      return resolution.resolve({ step, requestKey: `nested-request:${String(requestCounter)}`, lease });
    },
    check(step) {
      return resolution.check({ step });
    },
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      history.releaseWriter(lease);
      history.close();
    },
  };
}

/** Run one session to completion around `body`. */
export async function withNestedSession<T>(location: string, variation: IVariation, body: (session: INestedSession) => Promise<T>): Promise<T> {
  const session = openNestedSession(location, variation);
  try {
    return await body(session);
  } finally {
    session.close();
  }
}

/** Resolve both summaries in the variation's member order and return them keyed by member. */
export async function resolveSummaries(session: INestedSession, variation: IVariation = {}): Promise<Record<IMemberKey, IResolutionOutcome>> {
  const order = variation.order === 'reversed' ? [...memberKeys].reverse() : memberKeys;
  const outcomes = new Map<IMemberKey, IResolutionOutcome>();
  for (const key of order) {
    outcomes.set(key, await session.resolve(session.nested.steps[key].summary));
  }
  const ada = outcomes.get('person:ada');
  const ben = outcomes.get('person:ben');
  if (ada === undefined || ben === undefined) {
    throw new Error('both summaries must resolve');
  }
  return { 'person:ada': ada, 'person:ben': ben };
}

/** The exact reference locator of an outcome that produced or reused a result. */
export function referenceOf(outcome: IResolutionOutcome): string {
  if (outcome.kind === 'refused') {
    throw new Error(`expected a result, observed refusal of ${JSON.stringify(outcome.refused)}: ${outcome.reason}`);
  }
  return outcome.reference.locator;
}

/** The stored payload of an exact reference, read through History's exact subtree reader. */
export function payloadOf(history: IDurableHistory, locator: string): unknown {
  return history.reader.readSubtree({ kind: 'completed-result', locator }, []);
}

/** The scoped, versioned subject of one PR's assessment in this store. */
export function assessmentVersioned(subject: string): { readonly analysis: string; readonly environment: string; readonly subject: string; readonly version: number } {
  return { analysis: 'contribution-report:acme/widget', environment, subject, version: 1 };
}
