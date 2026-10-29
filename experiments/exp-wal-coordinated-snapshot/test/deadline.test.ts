/** Actual finite timers cancel owned fake workers without treating a timed-out body as completed cleanup. */
import { expect, test } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Peer } from '../node/peer.js';
import { OwnedDeadline } from '../node/deadline.js';
test('deadline terminates registered actual process and retains expiration until explicitly disposed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wal302-clock-'));
    const peers = new Set<Peer>();
    const failures: unknown[] = [];
    const clock = new OwnedDeadline(40, () => peers, failures, 'case');
    try {
        const peer = new Peer('R', 'no-response', dir, peers, { value: 0 }, { entrypoint: fileURLToPath(new URL('./peer-fixture.js', import.meta.url)) });
        await expect(peer.ask('status')).rejects.toBeDefined();
        await peer.exited;
        expect(peer.running).toBe(false);
        expect(() => clock.assert()).toThrow('case deadline');
        expect(clock.expired).toBe(true);
    }
    finally {
        clock.dispose();
        await Promise.all([...peers].map(peer => peer.abort()));
        await rm(dir, { recursive: true, force: true });
    }
});
import { withCaseBudget } from '../node/deadline.js';
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
test('delayed setup consumes the case clock and no otherwise runnable later cell is admitted', async () => { const shared = { expired: false }; let firstBody = false, laterBody = false; await expect(withCaseBudget(async () => { await delay(35); }, async () => { firstBody = true; }, { milliseconds: 20, shared, owners: () => [], failures: [], label: 'case', stageMilliseconds: 100 })).rejects.toThrow('deadline'); if (!shared.expired) {
    laterBody = true;
} expect(firstBody).toBe(false); expect(laterBody).toBe(false); });
test('stalled acquisition remains pending when its stage expires rather than claiming a finally ran', async () => { const shared = { expired: false }; let pending: readonly string[] = []; let bodyDone = false; const operation = withCaseBudget(async () => undefined, async (scope) => { await scope.stage('raw-open', async () => { await delay(40); bodyDone = true; }); scope.assert(); }, { milliseconds: 100, shared, owners: () => [], failures: [], label: 'case', stageMilliseconds: 10, notify: (_label, stages) => { pending = stages; } }); await delay(20); expect(shared.expired).toBe(true); expect(pending).toEqual(['raw-open']); expect(bodyDone).toBe(false); await expect(operation).rejects.toThrow('stage deadline'); });
