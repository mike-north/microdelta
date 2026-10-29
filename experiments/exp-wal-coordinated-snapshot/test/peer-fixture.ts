/** Deliberately finite non-native workers expose one transport defect per invocation. */
import { createInterface } from 'node:readline';
const mode = process.argv[3];
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
    const data: unknown = JSON.parse(line);
    if (typeof data !== 'object' || data === null || !('id' in data) || !('action' in data)) {
        throw new Error('bad fixture command');
    }
    if (mode === 'wrong-pair') {
        process.stdout.write(JSON.stringify({ id: data.id, kind: 'ok', pair: { revision: 1, currentRevision: 1, value: 'A' }, facts: { state: 'active', open: true, inTransaction: true, readonly: true } }) + '\n');
        continue;
    }
    if (mode === 'no-response') {
        continue;
    }
    if (mode === 'unexpected-exit') {
        process.exitCode = 1;
        break;
    }
    if (mode === 'malformed') {
        process.stdout.write('bad-json\n');
        continue;
    }
    if (mode === 'oversized') {
        process.stdout.write(`${'x'.repeat(8193)}\n`);
        continue;
    }
    if (mode === 'stderr-line') {
        process.stderr.write('x'.repeat(8193));
        continue;
    }
    if (mode === 'trailing' && data.action === 'exit') {
        process.stdout.write(JSON.stringify({ id: data.id, kind: 'exiting' }) + '\ntrailing');
        break;
    }
    if (mode === 'stderr-overflow') {
        process.stderr.write('x'.repeat(131073));
        continue;
    }
    process.stdout.write(`${JSON.stringify({ id: mode === 'wrong-id' ? -1 : data.id, kind: data.action === 'exit' ? 'exiting' : 'ok' })}\n`);
    if (data.action === 'exit') {
        break;
    }
}
lines.close();
