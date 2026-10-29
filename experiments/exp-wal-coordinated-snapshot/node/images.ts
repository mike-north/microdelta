/** Bounded sampled source images preserve exact bytes and deliberately make no transient-write absence claim. */
import { createHash } from 'node:crypto';
import { lstat, open, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
/** An image's exact regular-file bytes remain available for proof persistence. @internal */
export interface IFileImage {
    readonly name: string;
    readonly bytes: Buffer;
    readonly sha256: string;
    readonly dev: number;
    readonly ino: number;
}
/** Sorted entry inventory and exact bytes describe one paused-modifier barrier. @internal */
export interface ISourceImage {
    readonly files: readonly IFileImage[];
    readonly totalBytes: number;
}
/** Each descriptor is read once at explicit positions and closed even if imaging or postvalidation fails. @internal */
export async function sourceImage(directory: string, maximumBytes: number, retainedShm?: () => Promise<Buffer>, retainFile?: (file: IFileImage) => void): Promise<ISourceImage> {
    const names = (await readdir(directory)).sort();
    const files: IFileImage[] = [];
    let totalBytes = 0;
    for (const name of names) {
        const pathname = join(directory, name);
        const before = await lstat(pathname);
        if (!before.isFile() || before.size > 2097152) {
            throw new Error('Nonregular or oversized source entry');
        }
        totalBytes += before.size;
        if (totalBytes > maximumBytes) {
            throw new Error('Source sum quota exceeded');
        }
        let bytes: Buffer;
        if (name === 'store.sqlite-shm' && retainedShm) {
            bytes = await retainedShm();
        }
        else {
            const handle = await open(pathname, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                const stat = await handle.stat();
                if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size) {
                    throw new Error('Image identity changed');
                }
                bytes = Buffer.alloc(stat.size);
                let offset = 0;
                while (offset < bytes.length) {
                    const length = Math.min(65536, bytes.length - offset);
                    const read = await handle.read(bytes, offset, length, offset);
                    if (read.bytesRead !== length) {
                        throw new Error('Short source image read');
                    }
                    offset += length;
                }
                const after = await handle.stat();
                if (after.size !== stat.size) {
                    throw new Error('Image size changed');
                }
            }
            finally {
                await handle.close();
            }
        }
        const after = await lstat(pathname);
        if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || bytes.length !== before.size) {
            throw new Error('Image pathname changed');
        }
        const image = { name, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), dev: before.dev, ino: before.ino };
        files.push(image);
        retainFile?.(image);
    }
    if (JSON.stringify(names) !== JSON.stringify((await readdir(directory)).sort())) {
        throw new Error('Image entries changed');
    }
    return { files, totalBytes };
}
/** Main and committed WAL are immutable in reader-only windows; SHM coordination is finite and explicitly annotated. @internal */
export function forbiddenEffects(before: ISourceImage, after: ISourceImage): string[] {
    const issues: string[] = [];
    const old = new Map(before.files.map(file => [file.name, file]));
    const fresh = new Map(after.files.map(file => [file.name, file]));
    for (const name of new Set([...old.keys(), ...fresh.keys()])) {
        const a = old.get(name), b = fresh.get(name);
        if (!['store.sqlite', 'store.sqlite-wal', 'store.sqlite-shm', 'store.sqlite-journal'].includes(name)) {
            issues.push(`unexpected entry ${name}`);
            continue;
        }
        if (name === 'store.sqlite-shm') {
            if (a && !b) {
                issues.push('SHM disappearance');
            }
            if (a && b && (a.dev !== b.dev || a.ino !== b.ino)) {
                issues.push('SHM replacement');
            }
            continue;
        }
        if (a && b && (a.dev !== b.dev || a.ino !== b.ino)) {
            issues.push(`${name} replacement`);
        }
        if (name === 'store.sqlite-wal' && !a && b && b.bytes.length === 0) {
            continue;
        }
        if (a?.sha256 !== b?.sha256) {
            issues.push(name === 'store.sqlite' ? 'main bytes changed' : `${name} bytes changed`);
        }
    }
    return issues;
}
/** Q9's SHM collector receives only the remaining whole-source allowance, never a second image budget. @internal */
export async function remainingImageBytes(directory: string, maximumSourceBytes: number, maximumFileBytes: number): Promise<number> {
    let bytes = 0;
    for (const name of await readdir(directory)) {
        if (name === 'store.sqlite-shm') {
            continue;
        }
        const stat = await lstat(join(directory, name));
        if (!stat.isFile() || stat.size > maximumFileBytes) {
            throw new Error('Invalid aggregate image source');
        }
        bytes += stat.size;
        if (bytes > maximumSourceBytes) {
            throw new Error('Aggregate source quota exceeded');
        }
    }
    return maximumSourceBytes - bytes;
}
