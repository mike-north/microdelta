/** Raw-buffer effects regressions preserve the selected WAL coordination allowance without opening SQLite. */
import { expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { classifyEffects } from '../node/effects-policy.js';
import type { IEstablishedLayout } from '../node/effects-policy.js';
import type { IFileImage, ISourceImage } from '../node/images.js';

/** One acknowledged reader-only window can first attach, or use an already initialized index. */
const attach = { readerOnly: true, stage: 'anchor', firstAttachment: true } as const;
/** Existing live-owner read marks are independent of first-attacher reconstruction. */
const reading = { readerOnly: true, stage: 'anchor', firstAttachment: false } as const;
/** A healthy closed singleton fixture has exactly three pages under the selected default page size. */
const healthy: IEstablishedLayout = { kind: 'healthy-wal', ownership: 'closed-clean', pageSize: 4096, databasePages: 3, nativeByteOrder: 'LE' };
/** A foreign valid fixture has two pages and retains its inapplicable application-query outcome. */
const foreign: IEstablishedLayout = { ...healthy, databasePages: 2 };
/** Fixtures retain real image identities and hashes so content and lifecycle assertions exercise different facts. */
function file(name: string, bytes: Buffer, ino = 1): IFileImage { return { name, bytes, dev: 7, ino, sha256: createHash('sha256').update(bytes).digest('hex') }; }
/** Raw main headers establish only this bounded WAL page layout; no schema or History identity is claimed. */
function main(pages = 3): IFileImage {
    const bytes = Buffer.alloc(pages * 4096);
    bytes.write('SQLite format 3\0', 0, 'binary');
    bytes.writeUInt16BE(4096, 16);
    bytes[18] = 2;
    bytes[19] = 2;
    bytes.writeUInt32BE(pages, 28);
    return file('store.sqlite', bytes);
}
/** Test checksums independently implement the source's paired unsigned additions over forty native-order header bytes. */
function headerChecksum(bytes: Buffer, order: 'LE' | 'BE' = 'LE'): void {
    let a = 0, b = 0;
    for (let offset = 0; offset < 40; offset += 8) {
        a = (a + (order === 'LE' ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset)) + b) >>> 0;
        b = (b + (order === 'LE' ? bytes.readUInt32LE(offset + 4) : bytes.readUInt32BE(offset + 4)) + a) >>> 0;
    }
    if (order === 'LE') { bytes.writeUInt32LE(a, 40); bytes.writeUInt32LE(b, 44); }
    else { bytes.writeUInt32BE(a, 40); bytes.writeUInt32BE(b, 44); }
}
/** Empty recovery publishes two identical initialized headers, four unused marks and a zero first-region index. */
function index(frames = 0, pages = 3): Buffer {
    const bytes = Buffer.alloc(32768);
    bytes.writeUInt32LE(3007000, 0);
    bytes[12] = 1;
    if (frames) {
        bytes.writeUInt16LE(4096, 14);
        bytes.writeUInt32LE(frames, 16);
        bytes.writeUInt32LE(pages, 20);
        for (let frame = 0; frame < frames; frame++) {
            const page = 2 + frame % 2;
            bytes.writeUInt32LE(page, 136 + frame * 4);
            let slot = page * 383 % 8192;
            while (bytes.readUInt16LE(16384 + slot * 2) !== 0) { slot = (slot + 1) % 8192; }
            bytes.writeUInt16LE(frame + 1, 16384 + slot * 2);
        }
    }
    headerChecksum(bytes);
    bytes.copy(bytes, 48, 0, 48);
    for (let mark = 1; mark < 5; mark++) { bytes.writeUInt32LE(0xffffffff, 100 + mark * 4); }
    bytes.writeUInt32LE(frames, 128);
    return bytes;
}
/** The image recipe retains exact buffers; classifier output supplies annotations rather than another byte copy. */
function image(...files: IFileImage[]): ISourceImage { return { files, totalBytes: files.reduce((sum, value) => sum + value.bytes.length, 0) }; }

test('healthy closed WAL creation and exact empty-index initialization are explicitly allowed', () => {
    const before = image(main());
    const after = image(main(), file('store.sqlite-wal', Buffer.alloc(0), 2), file('store.sqlite-shm', index(), 3));
    const result = classifyEffects('Q1', healthy, attach, before, after);
    expect(result.forbidden).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.allowed).toHaveLength(2);
});

test('Q13 proved foreign-valid closed WAL retains known coordination allowance without claiming query applicability', () => {
    const result = classifyEffects('Q13', foreign, attach, image(main(2)), image(main(2), file('store.sqlite-wal', Buffer.alloc(0), 2), file('store.sqlite-shm', index(), 3)));
    expect(result.forbidden).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.allowed).toHaveLength(2);
});

for (const id of ['Q11', 'Q12', 'Q14', 'Q15']) {
    test(`${id} cannot inherit healthy-WAL sidecar allowance from an unrelated healthy case`, () => {
        const before = id === 'Q11' ? image() : image(file('store.sqlite', id === 'Q12' ? Buffer.alloc(0) : Buffer.alloc(64, 7)));
        const after = image(...before.files, file('store.sqlite-wal', Buffer.alloc(0), 2), file('store.sqlite-shm', index(), 3));
        const result = classifyEffects(id, healthy, attach, before, after);
        expect(result.allowed).toEqual([]);
        expect(result.forbidden.length + result.unknown.length).toBeGreaterThan(0);
    });
}

test('unknown SHM size and a familiar size with invalid layout remain unknown', () => {
    for (const bytes of [Buffer.alloc(7), Buffer.alloc(32768, 3)]) {
        const wal = file('store.sqlite-wal', Buffer.alloc(0), 2);
        const result = classifyEffects('Q1', healthy, attach, image(main(), wal), image(main(), wal, file('store.sqlite-shm', bytes, 3)));
        expect(result.allowed).toEqual([]);
        expect(result.forbidden).toEqual([]);
        expect(result.unknown).toHaveLength(1);
    }
});

test('first attachment recognizes exactly three new zero bytes and prefix-preserving truncation', () => {
    const emptyWal = file('store.sqlite-wal', Buffer.alloc(0), 2);
    const created = classifyEffects('Q1', healthy, attach, image(main(), emptyWal), image(main(), emptyWal, file('store.sqlite-shm', Buffer.alloc(3), 3)));
    expect(created.allowed).toHaveLength(1);
    expect(created.unknown).toEqual([]);
    expect(created.allowed[0]).toMatchObject({ changedRanges: [{ start: 0, end: 3 }], before: null, after: { size: 3, ino: 3 } });
    const original = index();
    const truncated = classifyEffects('Q7', { ...healthy, ownership: 'retained' }, attach, image(main(), emptyWal, file('store.sqlite-shm', original, 3)), image(main(), emptyWal, file('store.sqlite-shm', original.subarray(0, 3), 3)));
    expect(truncated.allowed).toHaveLength(1);
    expect(truncated.unknown).toEqual([]);
    expect(truncated.allowed[0]).toMatchObject({ changedRanges: [{ start: 3, end: 32768 }], before: { size: 32768, ino: 3 }, after: { size: 3, ino: 3 } });
});

test('an existing three-byte attachment can be reconstructed into the exact empty-WAL index', () => {
    const emptyWal = file('store.sqlite-wal', Buffer.alloc(0), 2);
    const result = classifyEffects('Q1', healthy, attach, image(main(), emptyWal, file('store.sqlite-shm', Buffer.alloc(3), 3)), image(main(), emptyWal, file('store.sqlite-shm', index(), 3)));
    expect(result.allowed).toHaveLength(1);
    expect(result.unknown).toEqual([]);
});

test('one native reader mark may advance to the stable committed frame while all other index bytes remain unchanged', () => {
    const beforeBytes = index(2);
    const afterBytes = Buffer.from(beforeBytes);
    afterBytes.writeUInt32LE(2, 104);
    const wal = file('store.sqlite-wal', Buffer.alloc(32 + 2 * 4120), 2);
    const result = classifyEffects('Q2', { ...healthy, ownership: 'live-owner' }, reading, image(main(), wal, file('store.sqlite-shm', beforeBytes, 3)), image(main(), wal, file('store.sqlite-shm', afterBytes, 3)));
    expect(result.allowed).toHaveLength(1);
    expect(result.unknown).toEqual([]);
});

test('unrecognized mutation, false read mark and live-owner truncation require disposition', () => {
    const beforeBytes = index(2);
    for (const [offset, value] of [[104, 3], [120, 1], [2000, 1]] as const) {
        const afterBytes = Buffer.from(beforeBytes);
        afterBytes[offset] = value;
        const wal = file('store.sqlite-wal', Buffer.alloc(32 + 2 * 4120), 2);
        const result = classifyEffects('Q2', { ...healthy, ownership: 'live-owner' }, reading, image(main(), wal, file('store.sqlite-shm', beforeBytes, 3)), image(main(), wal, file('store.sqlite-shm', afterBytes, 3)));
        expect(result.allowed).toEqual([]);
        expect(result.unknown).toHaveLength(1);
    }
    const wal = file('store.sqlite-wal', retainedWal(), 2);
    const truncated = classifyEffects('Q2', { ...healthy, ownership: 'live-owner' }, attach, image(main(), wal, file('store.sqlite-shm', beforeBytes, 3)), image(main(), wal, file('store.sqlite-shm', beforeBytes.subarray(0, 3), 3)));
    expect(truncated.allowed).toEqual([]);
    expect(truncated.unknown).toHaveLength(1);
});

test('unrecognized nonempty-WAL reconstruction remains unknown', () => {
    const wal = file('store.sqlite-wal', Buffer.alloc(32 + 2 * 4120), 2);
    const result = classifyEffects('Q7', { ...healthy, ownership: 'retained' }, attach, image(main(), wal), image(main(), wal, file('store.sqlite-shm', index(2), 3)));
    expect(result.allowed).toEqual([]);
    expect(result.unknown).toHaveLength(1);
});

/** Fixed source-format golden WAL: two 4096-byte frames on pages 2/3, with a final three-page commit and rolling checksums. */
function retainedWal(order: 'LE' | 'BE' = 'LE'): Buffer {
    if (order === 'BE') {
        return Buffer.concat([
            Buffer.from('377f0683002de21800001000000000001234567890abcdef28393d4f5fbdf2f7', 'hex'),
            Buffer.from('00000002000000001234567890abcdef6e06f231d7dee012', 'hex'), Buffer.alloc(4096, 1),
            Buffer.from('00000003000000031234567890abcdef7838d8fdacccc61f', 'hex'), Buffer.alloc(4096, 2),
        ]);
    }
    return Buffer.concat([
        Buffer.from('377f0682002de21800001000000000001234567890abcdef4d3d3725f4f2ba5a', 'hex'),
        Buffer.from('00000002000000001234567890abcdef756a8e3d35e0d131', 'hex'), Buffer.alloc(4096, 1),
        Buffer.from('00000003000000031234567890abcdefdfa967f9362ef00b', 'hex'), Buffer.alloc(4096, 2),
    ]);
}
/** The recovered header binds last commit, source salt bytes, frame checksum, checkpoint attempt and initial read mark. */
function recoveredIndex(): Buffer {
    const bytes = index(2);
    bytes.writeUInt32LE(3752421369, 24);
    bytes.writeUInt32LE(909045771, 28);
    Buffer.from('1234567890abcdef', 'hex').copy(bytes, 32);
    headerChecksum(bytes);
    bytes.copy(bytes, 48, 0, 48);
    bytes.writeUInt32LE(2, 104);
    return bytes;
}

test('Q7 retained committed WAL reconstructs exactly the finite source-grounded index', () => {
    const wal = file('store.sqlite-wal', retainedWal(), 2);
    const result = classifyEffects('Q7', { ...healthy, ownership: 'retained' }, attach, image(main(), wal), image(main(), wal, file('store.sqlite-shm', recoveredIndex(), 3)));
    expect(result.forbidden).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.allowed).toHaveLength(1);
    expect(result.allowed[0]).toMatchObject({ before: null, after: { size: 32768, dev: 7, ino: 3 }, changedRanges: [{ start: 0, end: 32768 }] });
});

test('Q7 recognition rejects mismatched header/frame checksums, salts, page map, commit and recovered state', () => {
    for (const offset of [4, 24, 32, 40, 32 + 24, 32 + 4120 + 7]) {
        const bad = retainedWal();
        bad[offset] = (bad[offset] ?? 0) ^ 1;
        const wal = file('store.sqlite-wal', bad, 2);
        const result = classifyEffects('Q7', { ...healthy, ownership: 'retained' }, attach, image(main(), wal), image(main(), wal, file('store.sqlite-shm', recoveredIndex(), 3)));
        expect(result.allowed).toEqual([]);
        expect(result.unknown).toHaveLength(1);
    }
    for (const offset of [8, 24, 32, 104, 128, 136]) {
        const bad = recoveredIndex();
        bad[offset] = (bad[offset] ?? 0) ^ 1;
        const wal = file('store.sqlite-wal', retainedWal(), 2);
        const result = classifyEffects('Q7', { ...healthy, ownership: 'retained' }, attach, image(main(), wal), image(main(), wal, file('store.sqlite-shm', bad, 3)));
        expect(result.allowed).toEqual([]);
        expect(result.unknown).toHaveLength(1);
    }
});

/** Construct a source-format recovered index in the explicitly witnessed native byte order, independently of WAL checksum word order. */
function orderedRecoveredIndex(native: 'LE' | 'BE', walOrder: 'LE' | 'BE'): Buffer {
    const bytes = Buffer.alloc(32768);
    const put32 = (value: number, offset: number): void => { if (native === 'LE') { bytes.writeUInt32LE(value, offset); } else { bytes.writeUInt32BE(value, offset); } };
    const put16 = (value: number, offset: number): void => { if (native === 'LE') { bytes.writeUInt16LE(value, offset); } else { bytes.writeUInt16BE(value, offset); } };
    put32(3007000, 0);
    bytes[12] = 1;
    bytes[13] = walOrder === 'LE' ? 0 : 1;
    put16(4096, 14);
    put32(2, 16);
    put32(3, 20);
    put32(walOrder === 'LE' ? 3752421369 : 2016991485, 24);
    put32(walOrder === 'LE' ? 909045771 : 2899101215, 28);
    Buffer.from('1234567890abcdef', 'hex').copy(bytes, 32);
    headerChecksum(bytes, native);
    bytes.copy(bytes, 48, 0, 48);
    put32(2, 104);
    for (const offset of [108, 112, 116]) { put32(0xffffffff, offset); }
    put32(2, 128);
    put32(2, 136);
    put32(3, 140);
    put16(1, 16384 + 766 * 2);
    put16(2, 16384 + 1149 * 2);
    return bytes;
}

for (const native of ['LE', 'BE'] as const) {
    for (const walOrder of ['LE', 'BE'] as const) {
        test(`Q7 recovery uses witnessed native ${native} order with WAL ${walOrder} checksums`, () => {
            const wal = file('store.sqlite-wal', retainedWal(walOrder), 2);
            const result = classifyEffects('Q7', { ...healthy, ownership: 'retained', nativeByteOrder: native }, attach, image(main(), wal), image(main(), wal, file('store.sqlite-shm', orderedRecoveredIndex(native, walOrder), 3)));
            expect(result.unknown).toEqual([]);
            expect(result.forbidden).toEqual([]);
            expect(result.allowed).toHaveLength(1);
        });
    }
}

test('case labels without fixture proof and mixed ownership windows cannot grant coordination allowances', () => {
    const before = image(main());
    const after = image(main(), file('store.sqlite-wal', Buffer.alloc(0), 2), file('store.sqlite-shm', index(), 3));
    for (const result of [classifyEffects('Q1', { kind: 'unproved' }, attach, before, after), classifyEffects('Q1', healthy, { ...attach, readerOnly: false }, before, after), classifyEffects('Q13', { ...foreign, ownership: 'live-owner' }, reading, before, after)]) {
        expect(result.allowed).toEqual([]);
        expect(result.unknown).toHaveLength(2);
    }
});

test('main mutation, committed WAL mutation, replacement/removal and new nonempty WAL stay forbidden', () => {
    const committedWal = file('store.sqlite-wal', Buffer.alloc(32, 1), 2), shm = file('store.sqlite-shm', index(), 3);
    const baseline = image(main(), committedWal, shm);
    for (const after of [image(file('store.sqlite', Buffer.alloc(12288, 1)), committedWal, shm), image(main(), file('store.sqlite-wal', Buffer.alloc(32, 2), 2), shm), image(main(), committedWal), image(main(), committedWal, file('store.sqlite-shm', index(), 9)), image(file('store.sqlite', main().bytes, 9), committedWal, shm)]) {
        expect(classifyEffects('Q1', healthy, attach, baseline, after).forbidden.length).toBeGreaterThan(0);
    }
    expect(classifyEffects('Q1', healthy, attach, image(main()), image(main(), file('store.sqlite-wal', Buffer.alloc(1), 2))).forbidden.length).toBeGreaterThan(0);
});

test('SHM format alone cannot claim a WAL-index transition when no WAL entry is observed', () => {
    for (const bytes of [Buffer.alloc(3), index()]) {
        const result = classifyEffects('Q1', healthy, attach, image(main()), image(main(), file('store.sqlite-shm', bytes, 3)));
        expect(result.allowed).toEqual([]);
        expect(result.unknown).toHaveLength(1);
    }
});
