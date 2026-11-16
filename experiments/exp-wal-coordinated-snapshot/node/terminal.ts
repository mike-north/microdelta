/** The outer process terminates within its absolute envelope even when asynchronous preparation or proof writes stay live. */
import { bounds } from '../src/protocol.js';
/** The inert seam can withhold a write callback; production uses only the process's own stdout and exit. @internal */
export interface ITerminalPort {
    readonly write: (bytes: string, done: (error?: Error | null) => void) => void;
    readonly exit: (code: number) => never;
}
/** An emitted summary is bounded separately from the full retained outer receipt. @internal */
export function terminalBoundary(startedAt: number, milliseconds: number = bounds.outerMilliseconds, port: ITerminalPort = { write: (bytes, done) => { process.stdout.write(bytes, done); }, exit: code => process.exit(code) }): (summary: unknown, code: number) => void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > bounds.outerMilliseconds) {
        throw new Error('Invalid terminal envelope');
    }
    const deadline = startedAt + milliseconds;
    const hard = setTimeout(() => port.exit(124), Math.max(0, deadline - Date.now()));
    let emitted = false;
    return (summary, code) => { if (emitted) {
        return;
    } emitted = true; let bytes = JSON.stringify(summary) + '\n'; if (Buffer.byteLength(bytes) > 32768) {
        bytes = JSON.stringify({ kind: 'terminal-summary-quota', receipt: 'outer-receipt.json', unresolved: 'full bounded receipt remains authority' }) + '\n';
        code = 1;
    } try {
        port.write(bytes, error => { clearTimeout(hard); port.exit(Date.now() >= deadline ? 124 : error ? 1 : code); });
    }
    catch {
        clearTimeout(hard);
        port.exit(1);
    } };
}
