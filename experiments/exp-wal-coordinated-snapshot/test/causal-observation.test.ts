/** Forced inert exits must retain actual received/raw-file facts without inventing persisted bytes or release. */
import { expect, test } from '@jest/globals';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { superviseCoordinator } from '../node/outer.js';
for (const mode of ['peer-proof', 'peer-cleanup', 'peer-unproved', 'peer-failed-prefix', 'q9-replacement', 'q9-disappearance', 'q9-fixture-prepared', 'physical-unknown', 'physical-forbidden']) {
    test(`${mode} survives permanent I/O and actual forced coordinator exit`, async () => {
        const output = await mkdtemp(join(tmpdir(), 'wal302-causal-'));
        try {
            const result = await superviseCoordinator({ execPath: process.execPath, entrypoint: fileURLToPath(new URL('./causal-observation-fixture.js', import.meta.url)), args: [mode, output], startedAt: Date.now(), output, policy: { campaignMilliseconds: 600, cleanupMilliseconds: 100, termMilliseconds: 100, outerMilliseconds: 1600 } });
            expect(result.forced).toBe(true);
            expect(result.signal).toBe('SIGKILL');
            expect(result.report).toBeUndefined();
            const observations = result.events.filter(value => value.kind === 'observation');
            if (mode === 'peer-unproved' || mode === 'peer-failed-prefix') { expect(observations).toEqual([]); }
            else {
                expect(observations).toHaveLength(1);
                expect(observations[0]).toMatchObject({ facts: { outcome: mode === 'physical-unknown' || mode === 'q9-fixture-prepared' ? 'unproved' : 'counterexample', rawProof: 'pending' } });
            }
            if (mode.startsWith('peer') && mode !== 'peer-unproved' && mode !== 'peer-failed-prefix') { expect(observations[0]).toMatchObject({ facts: { stage: 'R.anchor', pair: { value: 'A' } } }); }
            if (mode.startsWith('q9')) {
                expect(result.unresolved.measurement).toBe('owned');
                expect(observations[0]).toMatchObject({ facts: { effects: mode === 'q9-fixture-prepared' ? [] : ['Q9 attributed SHM disappearance/replacement'], measurement: { state: 'owned', complete: false }, attribution: mode === 'q9-fixture-prepared' ? 'owner-or-fixture' : 'reader-only', stage: mode === 'q9-fixture-prepared' ? 'fixture-prepared' : 'reader-anchor' } });
            }
            if (mode.startsWith('peer')) { expect(result.unresolved.pendingStages).toContain(mode === 'peer-cleanup' ? 'exit proof persistence' : 'stdout proof persistence'); }
            expect(result.failures).toContain('Coordinator result was not received');
            expect((await readdir(output)).some(name => name.includes('stdout') || name.includes('partial'))).toBe(false);
        } finally { await rm(output, { recursive: true, force: true }); }
    });
}
