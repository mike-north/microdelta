/** Finite synthetic SQLite-header fixtures corroborate layout only; they are not native qualification or schema-identity evidence. */
import { expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { establishLayout } from '../node/layout.js';
import type { ISourceImage } from '../node/images.js';
const owners = { writerLive: false, allPriorOwnersExited: true, closedNaturally: true };
function fixture(pages: 1 | 2 | 3): {
    image: ISourceImage;
    profile: unknown;
} { const bytes = Buffer.alloc(pages * 4096); Buffer.from('SQLite format 3\0', 'binary').copy(bytes); bytes.writeUInt16BE(4096, 16); bytes[18] = 2; bytes[19] = 2; bytes.writeUInt32BE(pages, 28); return { image: { totalBytes: bytes.length, files: [{ name: 'store.sqlite', bytes, dev: 1, ino: 7, sha256: createHash('sha256').update(bytes).digest('hex') }] }, profile: { nativeByteOrder: 'LE', files: [{ suffix: '', stat: { regular: true, dev: 1, ino: 7, size: bytes.length } }] } }; }
test('Q13 foreign-valid closed-WAL fixture uses observed byte order and at most two physical pages', () => { const value = fixture(2); expect(establishLayout('Q13', value.image, value.profile, owners)).toEqual({ kind: 'healthy-wal', ownership: 'closed-clean', pageSize: 4096, databasePages: 2, nativeByteOrder: 'LE' }); const tooLarge = fixture(3); expect(establishLayout('Q13', tooLarge.image, tooLarge.profile, owners).kind).toBe('unproved'); expect(establishLayout('Q13', value.image, value.profile, { ...owners, closedNaturally: false }).kind).toBe('unproved'); });
test.each(['Q11', 'Q12', 'Q14', 'Q15'])('%s never inherits a healthy-WAL allowance by its label', id => { const value = fixture(2); expect(establishLayout(id, value.image, value.profile, owners).kind).toBe('unproved'); });
test('stale profile identity or size cannot authorize a different current source image', () => { const value = fixture(3); expect(establishLayout('Q1', value.image, { nativeByteOrder: 'LE', files: [{ suffix: '', stat: { regular: true, dev: 1, ino: 999, size: value.image.totalBytes } }] }, owners).kind).toBe('unproved'); });
