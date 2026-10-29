/** The actual four-image control recipe uses a fresh inode baseline and an explicit deletion observation. */
import { expect, test } from '@jest/globals';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { effectControl, ProofBudget } from '../node/coordinator.js';
import { record } from '../node/peer.js';
test('actual non-SQLite control observes sensitivity and separately demonstrates between-barrier blindspot', async () => { const dir = await mkdtemp(join(tmpdir(), 'wal302-f7-')); try {
    const source = join(dir, 'source'), proof = join(dir, 'proof');
    await mkdir(source);
    await mkdir(proof);
    const result = await effectControl(source, proof, new ProofBudget());
    expect(result.conclusion.outcome).toBe('observed');
    expect(result.images).toHaveLength(4);
    expect('control' in result).toBe(true);
    if (!('control' in result) || !record(result.control)) {
        throw new Error('Missing control facts');
    }
    expect(result.control.deletion).toEqual({ kind: 'missing', code: 'ENOENT' });
    expect(result.control.blindspotObserved).toBe(true);
}
finally {
    await rm(dir, { recursive: true, force: true });
} });
import { assessEffectsControl } from '../node/effects-control.js';
import { createHash } from 'node:crypto';
import type { ISourceImage } from '../node/images.js';
const image = (ino: number, byte: number): ISourceImage => { const bytes = Buffer.alloc(16, byte); return { totalBytes: 16, files: [{ name: 'store.sqlite', ino, dev: 1, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }] }; };
test('new-inode baseline is independent; absent or non-ENOENT deletion cannot qualify', () => { const initial = image(1, 1), mutated = image(1, 2), fresh = image(2, 1), restored = image(2, 1); expect(assessEffectsControl(initial, mutated, { kind: 'missing', code: 'ENOENT' }, fresh, restored).observed).toBe(true); expect(assessEffectsControl(initial, mutated, { kind: 'missing', code: 'ENOENT' }, initial, restored).observed).toBe(false); expect(assessEffectsControl(initial, mutated, undefined, fresh, restored).observed).toBe(false); expect(assessEffectsControl(initial, mutated, { kind: 'failed', code: 'EACCES' }, fresh, restored).observed).toBe(false); });
test('actual deletion and mutation observations survive a later recreation failure', async () => { const dir = await mkdtemp(join(tmpdir(), 'wal302-f7-failure-')); try {
    const source = join(dir, 'source'), proof = join(dir, 'proof');
    await mkdir(source);
    await mkdir(proof);
    const failure = new Error('recreation failed');
    const result = await effectControl(source, proof, new ProofBudget(), { recreate: () => Promise.reject(failure) });
    expect(record(result.control) && result.control.deletionDetected).toBe(true);
    expect(record(result.control) && result.control.mutationDetected).toBe(true);
    expect(result.failures).toContainEqual({ type: 'Error', message: 'recreation failed' });
    expect(result.conclusion.outcome).toBe('unproved');
}
finally {
    await rm(dir, { recursive: true, force: true });
} });
