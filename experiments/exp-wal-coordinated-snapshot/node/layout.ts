/** Physical fixture witnesses authorize only this experiment's finite WAL coordination policy, never History/schema identity. */
import type { IEstablishedLayout } from './effects-policy.js';
import type { ISourceImage } from './images.js';
import { record } from './peer.js';
/** Owner state is proven by actual IPC/exit receipts outside the candidate reader window. @internal */
export interface ILayoutOwners {
    readonly writerLive: boolean;
    readonly allPriorOwnersExited: boolean;
    readonly closedNaturally: boolean;
}
/** Header/size, sidecar layout, owner lifetime and measured native byte order must agree before any allowance applies. @internal */
export function establishLayout(caseId: string, image: ISourceImage | undefined, profile: unknown, owners: ILayoutOwners): IEstablishedLayout {
    if (!image || ['Q11', 'Q12', 'Q14', 'Q15'].includes(caseId) || !record(profile) || (profile.nativeByteOrder !== 'LE' && profile.nativeByteOrder !== 'BE')) {
        return { kind: 'unproved' };
    }
    const mainFile = image.files.find(file => file.name === 'store.sqlite');
    const main = mainFile?.bytes;
    const files: unknown[] = Array.isArray(profile.files) ? profile.files : [];
    const observed = files.find(value => record(value) && value.suffix === '');
    if (!mainFile || !record(observed) || !record(observed.stat) || observed.stat.regular !== true || observed.stat.dev !== mainFile.dev || observed.stat.ino !== mainFile.ino || observed.stat.size !== mainFile.bytes.length) {
        return { kind: 'unproved' };
    }
    if (!main || main.length < 100 || !main.subarray(0, 16).equals(Buffer.from('SQLite format 3\0', 'binary')) || main.readUInt16BE(16) !== 4096 || main[18] !== 2 || main[19] !== 2) {
        return { kind: 'unproved' };
    }
    const pages = main.readUInt32BE(28);
    if ((pages !== 1 && pages !== 2 && pages !== 3) || main.length !== pages * 4096 || caseId === 'Q13' && pages > 2) {
        return { kind: 'unproved' };
    }
    const wal = image.files.find(file => file.name === 'store.sqlite-wal'), shm = image.files.find(file => file.name === 'store.sqlite-shm');
    let ownership: 'closed-clean' | 'retained' | 'live-owner';
    if (owners.writerLive) {
        ownership = 'live-owner';
    }
    else if (owners.allPriorOwnersExited && owners.closedNaturally && !wal && !shm) {
        ownership = 'closed-clean';
    }
    else if (owners.allPriorOwnersExited && wal && wal.bytes.length > 32) {
        ownership = 'retained';
    }
    else {
        return { kind: 'unproved' };
    }
    if (caseId === 'Q13' && ownership !== 'closed-clean') {
        return { kind: 'unproved' };
    }
    return { kind: 'healthy-wal', ownership, pageSize: 4096, databasePages: pages, nativeByteOrder: profile.nativeByteOrder };
}
