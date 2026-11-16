/** Received facts and physical observations are retained independently of proof persistence. */
import type { IReply } from './peer.js';
import { record } from './peer.js';
import { evaluateCell, pair } from './oracle.js';
import type { IStageRecord } from './oracle.js';
import { publishEvent } from './runtime-events.js';
import type { IMeasurementImage } from './measurement.js';
/** A bounded peer exposes the last validated reply even if its ask rejects after receiving it. @internal */
export interface IReceivingPeer {
    readonly ask: (action: string) => Promise<IReply>;
    readonly lastReceived: {
        readonly action: string;
        readonly reply: IReply;
    } | undefined;
}
/** Recover a received stage before propagating its primary transport/persistence failure. @internal */
export async function askStage(peer: IReceivingPeer, stage: string, action: string, records: IStageRecord[]): Promise<IReply> { try {
    return await peer.ask(action);
}
catch (error: unknown) {
    const received = peer.lastReceived;
    if (received?.action === action) {
        records.push({ stage, reply: received.reply });
    }
    throw error;
} }
/** Partial images remain actual evidence, including the same byte object and source observations. @internal */
export interface IMeasurementReceipt {
    readonly image: IMeasurementImage;
    readonly forbidden: readonly string[];
    readonly failures: readonly unknown[];
}
/** Retain already observed lifecycle facts and the exact partial image before attempting proof persistence. @internal */
export async function retainMeasurement(image: IMeasurementImage, readerWindow: boolean, persist: (bytes: Uint8Array) => void | Promise<void>, observe?: (receipt: IMeasurementReceipt) => void): Promise<IMeasurementReceipt> { const failures: unknown[] = []; const missing = image.observations.some(value => value.source === 'path' && record(value.error) && value.error.code === 'ENOENT'); const forbidden = readerWindow && (missing || image.issues.includes('pathname identity changed')) ? ['Q9 attributed SHM disappearance/replacement'] : []; observe?.({ image, forbidden, failures }); if (!image.complete) {
    try {
        await persist(image.bytes);
    }
    catch (error: unknown) {
        failures.push(error);
    }
} return { image, forbidden, failures }; }

/** A decisive payload must be retained at reception rather than after proof settles. @internal */
export function observeReply(id: string, records: readonly IStageRecord[], stage: string, reply: IReply, expected: readonly string[], fixtureReady: boolean): void {
    if (evaluateCell(id, [...records, { stage, reply }], [], false, expected, fixtureReady).outcome !== 'counterexample') { return; }
    const value = pair(reply.pair);
    const failure = record(reply.failure) ? { type: reply.failure.type, code: reply.failure.code, message: typeof reply.failure.message === 'string' ? reply.failure.message.slice(0, 180) : undefined } : undefined;
    sendObservation({ cell: id, outcome: 'counterexample', stage, pair: value, failure, rawProof: 'pending', attribution: 'validated reply with established causal prefix' });
}
/** An image's actual intervening owners and capture stage delimit candidate attribution. @internal */
export interface IPhysicalObservationContext {
    readonly attribution: 'reader-only' | 'owner-or-fixture';
    readonly stage: string;
}
/** Actual physical facts precede raw-image persistence; their owner/stage label never implies raw proof or resource closure. @internal */
export function observePhysical(id: string, forbidden: readonly string[], unknown: readonly string[], measurement: unknown, context: IPhysicalObservationContext): void {
    if (!forbidden.length && !unknown.length) { return; }
    sendObservation({ cell: id, outcome: forbidden.length ? 'counterexample' : 'unproved', effects: forbidden, unknown, measurement, rawProof: 'pending', attribution: context.attribution, stage: context.stage });
}
/** The existing outer observation allowance bounds a complete summary; overflow remains an explicit harness failure. */
function sendObservation(facts: unknown): void {
    const event = { kind: 'observation', facts };
    if (Buffer.byteLength(JSON.stringify(event)) > 8192) { throw new Error('Observation exceeds existing 8192-byte quota'); }
    publishEvent(event);
}
