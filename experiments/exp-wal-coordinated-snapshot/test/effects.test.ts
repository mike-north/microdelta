/** Ordinary raw-file image controls express sampled effects and their known between-barrier blindspot. */
import { expect, test } from '@jest/globals';
import { mkdtemp, writeFile, rm, unlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sourceImage, forbiddenEffects } from '../node/images.js';
test('main and committed WAL mutation, deletion and unknown entries are forbidden; bounded native SHM is annotated', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wal302-effects-'));
    try {
        await writeFile(join(dir, 'store.sqlite'), Buffer.alloc(16, 1));
        const a = await sourceImage(dir, 262144);
        await writeFile(join(dir, 'store.sqlite-shm'), Buffer.alloc(3));
        const b = await sourceImage(dir, 262144);
        expect(forbiddenEffects(a, b)).toEqual([]);
        await writeFile(join(dir, 'store.sqlite'), Buffer.alloc(16, 2));
        expect(forbiddenEffects(b, await sourceImage(dir, 262144))).toContain('main bytes changed');
        await writeFile(join(dir, 'unknown'), Buffer.alloc(1));
        expect(forbiddenEffects(a, await sourceImage(dir, 262144))).toContain('unexpected entry unknown');
        await unlink(join(dir, 'unknown'));
        await writeFile(join(dir, 'store.sqlite'), Buffer.alloc(16, 1));
        await unlink(join(dir, 'store.sqlite-shm'));
        expect(forbiddenEffects(a, await sourceImage(dir, 262144))).toEqual([]);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('same-byte main replacement is a forbidden lifecycle effect', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wal302-replace-'));
    try {
        await writeFile(join(dir, 'store.sqlite'), Buffer.alloc(16, 1));
        const before = await sourceImage(dir, 262144);
        await writeFile(join(dir, 'replacement'), Buffer.alloc(16, 1));
        await rename(join(dir, 'replacement'), join(dir, 'store.sqlite'));
        expect(forbiddenEffects(before, await sourceImage(dir, 262144))).toContain('store.sqlite replacement');
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
