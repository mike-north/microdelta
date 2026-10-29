/** Proof-write failures are adapter regressions, never manufactured native errors or qualification evidence. */
import { expect, test } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { askStage, retainMeasurement } from '../node/receipts.js';
import { Peer } from '../node/peer.js';
import { evaluateCell } from '../node/oracle.js';
import type { IStageRecord } from '../node/oracle.js';
import { validateLedger } from '../node/schedule.js';
import { scenario } from './recorded-scenarios.js';
import type { IMeasurementImage } from '../node/measurement.js';
const ledger = validateLedger(JSON.parse(await readFile(new URL('../../../../experiments/exp-wal-coordinated-snapshot/command-ledger.json', import.meta.url), 'utf8')) as unknown);
test('actual received wrong pair is REJECT despite stdout and cleanup-receipt persistence failures', async () => { const row = ledger.rows.find(value => value.id === 'Q1'); if (!row) {
    throw new Error('missing Q1');
} const records: IStageRecord[] = scenario(row).slice(0, row.orderedCommands.indexOf('R.anchor')); const dir = await mkdtemp(join(tmpdir(), 'wal302-f6-')); const peers = new Set<Peer>(); const primary = new Error('stdout ENOSPC'), secondary = new Error('exit receipt ENOSPC'); try {
    const peer = new Peer('R', 'wrong-pair', dir, peers, { value: 0 }, { entrypoint: fileURLToPath(new URL('./peer-fixture.js', import.meta.url)), persist: path => { if (path.endsWith('stdout.jsonl')) {
            throw primary;
        } if (path.endsWith('exit.jsonl')) {
            throw secondary;
        } } });
    await expect(askStage(peer, 'R.anchor', 'anchor', records)).rejects.toBe(primary);
    await peer.abort();
    expect(evaluateCell('Q1', records, [], false, row.orderedCommands, true).outcome).toBe('counterexample');
    expect(peer.failureFacts).toEqual([primary, secondary]);
    expect(records.at(-1)?.reply.pair).toEqual({ revision: 1, currentRevision: 1, value: 'A' });
}
finally {
    await Promise.all([...peers].map(peer => peer.abort()));
    await rm(dir, { recursive: true, force: true });
} });
test.each(['replacement', 'disappearance'])('detected Q9 %s survives partial-byte proof-write failure', async (kind) => { const bytes = new Uint8Array([1, 2]); const image: IMeasurementImage = { label: 'reader-stage', complete: false, bytes, issues: kind === 'replacement' ? ['pathname identity changed'] : ['path before stat failed'], observations: kind === 'disappearance' ? [{ stage: 'before', source: 'path', error: { code: 'ENOENT' } }] : [{ stage: 'before', source: 'path', stat: { device: '1', inode: 'new', size: 2, regular: true } }] }; const error = new Error('partial ENOSPC'); const receipt = await retainMeasurement(image, true, () => { throw error; }); expect(receipt.image).toBe(image); expect(receipt.image.bytes).toBe(bytes); expect(receipt.forbidden).toEqual(['Q9 attributed SHM disappearance/replacement']); expect(receipt.failures).toEqual([error]); expect(evaluateCell('Q9', [], receipt.forbidden, false, [], true).outcome).toBe('counterexample'); });
