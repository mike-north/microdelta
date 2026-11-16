/** Finite fake peers exercise ownership and protocol failure without native database access. */
import { expect, test } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Peer } from '../node/peer.js';
/** Each peer fixture owns a disposable proof directory and remains registered through actual close. */
async function run(mode: string, operation: (peer: Peer, registry: Set<Peer>) => Promise<void>): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'wal302-peer-'));
    const registry = new Set<Peer>();
    try {
        const peer = new Peer('R', mode, directory, registry, { value: 0 }, { entrypoint: fileURLToPath(new URL('./peer-fixture.js', import.meta.url)) });
        await operation(peer, registry);
    }
    finally {
        await Promise.all([...registry].map(peer => peer.abort()));
        await rm(directory, { recursive: true, force: true });
    }
}
test('acknowledgment plus actual natural exit is required; three inherited pipes only', async () => { await run('normal', async (peer) => { expect((await peer.ask('status')).kind).toBe('ok'); expect(await peer.finish()).toEqual({ code: 0, signal: null }); expect(peer.running).toBe(false); }); });
test.each(['wrong-id', 'malformed', 'unexpected-exit', 'oversized', 'stderr-overflow'])('rejects %s while retaining actual cleanup', async (mode) => { await run(mode, async (peer) => { await expect(peer.ask('status')).rejects.toBeDefined(); await peer.abort(); expect(peer.running).toBe(false); }); });
test('persistence failure still owns and terminates child', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wal302-persistence-'));
    const registry = new Set<Peer>();
    try {
        const peer = new Peer('R', 'normal', dir, registry, { value: 0 }, { entrypoint: fileURLToPath(new URL('./peer-fixture.js', import.meta.url)), persist: () => { throw new Error('disk failure'); } });
        await expect(peer.ask('status')).rejects.toThrow('disk failure');
        await peer.abort();
        expect(peer.running).toBe(false);
        expect(registry.has(peer)).toBe(true);
    }
    finally {
        await Promise.all([...registry].map(peer => peer.abort()));
        await rm(dir, { recursive: true, force: true });
    }
});
test('a response acknowledgment cannot free a live child concurrency slot', async () => { await run('normal', async (peer, registry) => { await peer.ask('status'); const second = new Peer('R', 'normal', peer.proofDirectory, registry, { value: 0 }, { entrypoint: fileURLToPath(new URL('./peer-fixture.js', import.meta.url)) }); expect(() => new Peer('R', 'normal', peer.proofDirectory, registry, { value: 0 })).toThrow('concurrency'); await second.finish(); }); });
test('oversized stderr line refuses before aggregate quota', async () => { await run('stderr-line', async (peer) => { await expect(peer.ask('status')).rejects.toThrow('line'); }); });
test('trailing unframed bytes cannot accompany acknowledged natural success', async () => { await run('trailing', async (peer) => { await expect(peer.finish()).rejects.toThrow('Unterminated'); }); });
test('validated wrong-pair reply survives stdout proof-write failure with a stage recovery receipt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wal302-received-'));
    const registry = new Set<Peer>();
    try {
        const peer = new Peer('R', 'wrong-pair', dir, registry, { value: 0 }, { entrypoint: fileURLToPath(new URL('./peer-fixture.js', import.meta.url)), persist: (path, bytes) => { if (path.endsWith('stdout.jsonl')) {
                throw new Error('stdout ENOSPC');
            } void bytes; } });
        await expect(peer.ask('anchor')).rejects.toThrow('stdout ENOSPC');
        expect(peer.records[0]?.pair).toEqual({ revision: 1, currentRevision: 1, value: 'A' });
        expect(peer.lastReceived?.action).toBe('anchor');
        expect(peer.lastReceived?.reply).toBe(peer.records[0]);
        await peer.abort();
        expect(peer.failureFacts[0]).toEqual(new Error('stdout ENOSPC'));
    }
    finally {
        await Promise.all([...registry].map(peer => peer.abort()));
        await rm(dir, { recursive: true, force: true });
    }
});
