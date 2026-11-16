/** Inert coordinator exercises actual receipt ordering; recorded prefixes are synthetic, never native evidence. */
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Peer } from '../node/peer.js';
import { retainMeasurement, observeReply, observePhysical } from '../node/receipts.js';
import { publishEvent } from '../node/runtime-events.js';
import { withRetainedShm } from '../node/measurement.js';
import { sourceImage } from '../node/images.js';
import { caseEffects } from '../node/case-effects.js';
import { validateLedger } from '../node/schedule.js';
import { scenario } from './recorded-scenarios.js';
const mode = process.argv[2], root = process.argv[3];
if (!mode || !root) { throw new Error('Fixture arguments missing'); }
process.on('SIGTERM', () => undefined);
setInterval(() => undefined, 1000);
/** An intentionally unsettled I/O port has no timer or false completion receipt. */
const pending = (): Promise<void> => new Promise(() => undefined);
const ledger = validateLedger(JSON.parse(await readFile(new URL('../../../../experiments/exp-wal-coordinated-snapshot/command-ledger.json', import.meta.url), 'utf8')) as unknown);
const row = ledger.rows.find(value => value.id === 'Q1');
if (!row) { throw new Error('Q1 absent'); }
const records = scenario(row).slice(0, row.orderedCommands.indexOf('R.anchor'));
if (mode === 'peer-failed-prefix') { const first = records[0]; if (first) { records[0] = { ...first, reply: { id: 1, kind: 'failed' } }; } }
if (mode.startsWith('peer')) {
    const peer = new Peer('R', 'wrong-pair', root, new Set(), { value: 0 }, {
        entrypoint: fileURLToPath(new URL('./peer-fixture.js', import.meta.url)), stageMilliseconds: 3000,
        persist: path => path.endsWith(mode !== 'peer-cleanup' ? 'stdout.jsonl' : 'exit.jsonl') ? pending() : undefined,
        onReceived: (action, reply) => { observeReply('Q1', records, `R.${action}`, reply, row.orderedCommands, mode !== 'peer-unproved'); if (mode !== 'peer-cleanup') { publishEvent({ kind: 'expired', label: 'inert pending proof', at: Date.now(), pendingStages: ['stdout proof persistence'] }); } }
    });
    try { await peer.ask('anchor'); } catch { await pending(); }
    publishEvent({ kind: 'expired', label: 'cleanup pending', at: Date.now(), pendingStages: ['exit proof persistence'] });
    await peer.abort();
    await pending();
} else if (mode.startsWith('q9')) {
    const path = join(root, 'store.sqlite-shm');
    await writeFile(path, Buffer.alloc(16, 1));
    await withRetainedShm(path, { imagesUsed: 0, bytesUsed: 0, maxImages: 2, maxBytes: 64, maxFileBytes: 32, maxImageBytes: 32 }, async retained => {
        publishEvent({ kind: 'measurement', state: 'owned' });
        if (mode === 'q9-replacement') { await rename(path, `${path}.old`); await writeFile(path, Buffer.alloc(16, 2)); }
        else { await unlink(path); }
        const image = await retained.capture(mode === 'q9-fixture-prepared' ? 'fixture-prepared' : 'reader-anchor');
        await retainMeasurement(image, mode !== 'q9-fixture-prepared', pending, receipt => {
            observePhysical('Q9', receipt.forbidden, image.issues, { state: 'owned', complete: image.complete, bytesRead: image.bytes.byteLength, rawProof: 'pending' }, { attribution: mode === 'q9-fixture-prepared' ? 'owner-or-fixture' : 'reader-only', stage: image.label });
        });
    });
} else {
    const source = join(root, 'source');
    await mkdir(source);
    if (mode === 'physical-forbidden') { await writeFile(join(source, 'store.sqlite'), Buffer.from('A')); }
    const before = await sourceImage(source, 262144);
    await writeFile(join(source, mode === 'physical-forbidden' ? 'store.sqlite' : 'store.sqlite-shm'), Buffer.from(mode === 'physical-forbidden' ? 'B' : '12345'));
    const after = await sourceImage(source, 262144);
    const result = caseEffects('Q1', { kind: 'unproved' }, { readerOnly: true, stage: 'anchor', firstAttachment: true }, { proved: false, image: before }, before, after);
    observePhysical('Q1', result.forbidden.map(value => `${value.file}: ${value.reason}`), result.unknown.map(value => `${value.file}: ${value.reason}`), { rawProof: 'pending' }, { attribution: 'reader-only', stage: 'reader-anchor' });
    publishEvent({ kind: 'measurement', state: 'unresolved' });
    await pending();
}
