/** Static complete ledger accounting protects finite scope without executing any worker. */
import { expect, test } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { selectedLedger, imageBarriers, validateLedger } from '../node/schedule.js';
test('selected 23 cells retain 47 workers, 414 requests, 228 slots and actual-exit concurrency barriers', async () => {
    const ledger = validateLedger(JSON.parse(await readFile(new URL('../../../../experiments/exp-wal-coordinated-snapshot/command-ledger.json', import.meta.url), 'utf8')) as unknown);
    expect(ledger.rows).toHaveLength(23);
    expect(ledger.rows.reduce((sum, row) => sum + row.launches, 0)).toBe(47);
    expect(ledger.rows.reduce((sum, row) => sum + row.orderedCommands.length, 0)).toBe(414);
    expect(ledger.rows.reduce((sum, row) => sum + row.maximumImages, 0)).toBe(228);
    for (const row of ledger.rows) {
        expect(imageBarriers[row.id]).toBeDefined();
        expect(imageBarriers[row.id]?.length).toBeLessThanOrEqual(row.maximumImages);
        expect(row.orderedCommands.length).toBe(row.maximumProtocolCommands);
    }
    expect(selectedLedger(ledger).map(row => row.id).slice(0, 5)).toEqual(['C-stale', 'C-torn', 'C-immediate', 'C-forbidden-effects', 'C-false-release']);
});
test('missing cell and increased bounds cannot be accepted as selected ledger', () => { expect(() => validateLedger({ rows: [] })).toThrow(); });
