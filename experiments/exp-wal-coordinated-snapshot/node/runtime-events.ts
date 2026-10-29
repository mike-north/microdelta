/** The fixed outer launcher receives bounded ownership/evidence facts; workers have no IPC channel. */
/** Channel failures are retained as harness causes without replacing observed candidate facts. @internal */
export const eventFailures: unknown[] = [];
/** Events are finite records governed by the outer's byte/message ceilings, never process commands. @internal */
export function publishEvent(event: unknown): void { if (!process.send || !process.connected) {
    return;
} try {
    process.send(event, error => { if (error) {
        eventFailures.push(error);
    } });
}
catch (error: unknown) {
    eventFailures.push(error);
} }
/** Final result waits for the IPC callback before the coordinator disconnects naturally. @internal */
export async function publishResult(report: unknown): Promise<void> { if (!process.send || !process.connected) {
    throw new Error('Independent outer channel unavailable');
} await new Promise<void>((resolve, reject) => { process.send?.({ kind: 'result', report }, error => { if (error) {
    reject(error);
}
else {
    resolve();
} }); }); }
