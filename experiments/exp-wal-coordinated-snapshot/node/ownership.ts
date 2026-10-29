/** Measurement scope cleanup composes raw descriptor ownership with actual-exit worker ownership. */
import { withRetainedShm } from './measurement.js';
import type { IMeasurementBudget, IMeasurementOutcome, IMeasurementPort, IRetainedMeasurement } from './measurement.js';
/** Only actual close, not an acknowledgment, makes an owned process no longer running. @internal */
export interface IOwnedProcess {
    readonly running: boolean;
    readonly abort: () => Promise<unknown>;
}
/** All owners get a cleanup attempt concurrently within their common finite cleanup allowance. @internal */
export async function settleOwners(peers: Iterable<IOwnedProcess>): Promise<unknown[]> {
    const results = await Promise.allSettled([...peers].filter(peer => peer.running).map(peer => peer.abort()));
    const failures: unknown[] = [];
    for (const result of results) {
        if (result.status === 'rejected') {
            const cause: unknown = result.reason;
            failures.push(cause);
        }
    }
    return failures;
}
/** Returned measurement evidence and worker cleanup failures are separate result dimensions. @internal */
export interface IOwnershipOutcome<T> {
    readonly measurement: IMeasurementOutcome<T>;
    readonly ownerFailures: readonly unknown[];
}
/** Owner-exit waits precede descriptor close; callers restore fixture modes only after both outcomes resolve. @internal */
export async function withMeasurementOwners<T>(path: string, budget: IMeasurementBudget, peers: Iterable<IOwnedProcess>, body: (measurement: IRetainedMeasurement) => Promise<T>, port?: IMeasurementPort): Promise<IOwnershipOutcome<T>> {
    const ownerFailures: unknown[] = [];
    const measurement = await withRetainedShm(path, budget, async (retained) => {
        try {
            return await body(retained);
        }
        finally {
            ownerFailures.push(...await settleOwners(peers));
        }
    }, port);
    return { measurement, ownerFailures };
}
