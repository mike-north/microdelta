/** Raw synthetic images test only the selected case-specific preservation contract; no native engine is involved. */
import { expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { caseEffects } from '../node/case-effects.js';
import type { ISourceImage } from '../node/images.js';
const image = (files: readonly {
    readonly name: string;
    readonly bytes: Buffer;
}[]): ISourceImage => ({ totalBytes: files.reduce((n, file) => n + file.bytes.length, 0), files: files.map((file, index) => ({ ...file, dev: 1, ino: index + 1, sha256: createHash('sha256').update(file.bytes).digest('hex') })) });
const context = { readerOnly: true, stage: 'open' as const, firstAttachment: true };
for (const id of ['Q11', 'Q12']) {
    for (const name of ['store.sqlite-wal', 'store.sqlite-shm']) {
        test(`${id} proved original input forbids new empty ${name}`, () => { const base = image(id === 'Q11' ? [] : [{ name: 'store.sqlite', bytes: Buffer.alloc(0) }]); const after = image([...base.files.map(file => ({ name: file.name, bytes: file.bytes })), { name, bytes: Buffer.alloc(0) }]); const result = caseEffects(id, { kind: 'unproved' }, context, { proved: true, image: base }, base, after); expect(result.forbidden).toHaveLength(1); expect(result.forbidden[0]?.after?.size).toBe(0); expect(result.unknown).toEqual([]); });
    }
}
test('missing baseline or reader-only attribution keeps unexplained sidecars unknown', () => { const base = image([]), after = image([{ name: 'store.sqlite-wal', bytes: Buffer.alloc(0) }]); expect(caseEffects('Q11', { kind: 'unproved' }, context, { proved: false, image: base }, base, after).unknown).toHaveLength(1); expect(caseEffects('Q11', { kind: 'unproved' }, { ...context, readerOnly: false }, { proved: true, image: base }, base, after).unknown).toHaveLength(1); });
test.each(['Q13', 'Q14', 'Q15'])('%s gains no blanket source restriction from another case', id => { const base = image([]), after = image([{ name: 'store.sqlite-wal', bytes: Buffer.alloc(0) }]); const result = caseEffects(id, { kind: 'unproved' }, context, { proved: true, image: base }, base, after); expect(result.forbidden).toEqual([]); expect(result.unknown).toHaveLength(1); });
