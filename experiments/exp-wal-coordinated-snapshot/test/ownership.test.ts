/** The actual coordinator ownership helper is exercised with finite raw-file/fake-process ports, never SQLite. */
import { expect, test } from '@jest/globals';
import { mkdtemp, open, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Peer } from '../node/peer.js';
import { withMeasurementOwners } from '../node/ownership.js';
import { remainingImageBytes } from '../node/images.js';
import { rawMeasurementPort } from '../node/measurement.js';
test('real stage expiry settles actual owned child before descriptor close and later permission restoration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wal302-owned-'));
    const path = join(dir, 'store.sqlite-shm');
    const peers = new Set<Peer>();
    const order: string[] = [];
    try {
        await writeFile(path, Buffer.from('literal'));
        const outcome = await withMeasurementOwners(path, { imagesUsed: 0, bytesUsed: 0, maxImages: 1, maxBytes: 256, maxImageBytes: 256, maxFileBytes: 256 }, peers, async (measurement) => {
            const peer = new Peer('R', 'no-response', dir, peers, { value: 0 }, { entrypoint: fileURLToPath(new URL('./peer-fixture.js', import.meta.url)), stageMilliseconds: 40 });
            await chmod(path, 0);
            expect((await measurement.capture('before-timeout')).complete).toBe(true);
            await peer.ask('status');
        }, { ...rawMeasurementPort, open: async (location) => { const handle = await rawMeasurementPort.open(location); return { ...handle, close: async () => { expect([...peers].every(peer => !peer.running)).toBe(true); order.push('descriptor-close'); await handle.close(); } }; } });
        expect(outcome.measurement.completed).toBe(false);
        expect(outcome.measurement.failures[0]).toEqual(new Error('Stage deadline exceeded'));
        expect(outcome.ownerFailures).toEqual([]);
        expect(outcome.measurement.closure.resolved).toBe(true);
        expect([...peers].every(peer => !peer.running)).toBe(true);
        order.push('actual-owner-exit-already-observed');
        await chmod(path, 0o600);
        order.push('mode-restoration');
        expect(order).toEqual(['descriptor-close', 'actual-owner-exit-already-observed', 'mode-restoration']);
    }
    finally {
        await Promise.all([...peers].map(peer => peer.abort()));
        await chmod(path, 0o600).catch(() => undefined);
        await rm(dir, { recursive: true, force: true });
    }
});
test('source aggregate quota includes main/WAL and retained SHM within one image slot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wal302-aggregate-'));
    const path = join(dir, 'store.sqlite-shm');
    try {
        await writeFile(path, Buffer.alloc(64));
        await writeFile(join(dir, 'store.sqlite'), Buffer.alloc(120));
        await writeFile(join(dir, 'store.sqlite-wal'), Buffer.alloc(80));
        const remainder = await remainingImageBytes(dir, 256, 128);
        expect(remainder).toBe(56);
        let bodyEntered = false;
        const outcome = await withMeasurementOwners(path, { imagesUsed: 0, bytesUsed: 0, maxImages: 1, maxBytes: 256, maxImageBytes: remainder, maxFileBytes: 128 }, new Set(), async () => { bodyEntered = true; });
        expect(bodyEntered).toBe(false);
        expect(outcome.measurement.closure.resolved).toBe(true);
        const handle = await open(path, 'r');
        await handle.close();
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
