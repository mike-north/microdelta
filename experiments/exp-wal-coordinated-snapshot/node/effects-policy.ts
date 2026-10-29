/**
 * Sampled reader-window effects have three dispositions: known native coordination,
 * an observed forbidden effect, or an unexplained effect requiring disposition.
 * This finite Unix/4096-byte-page experiment policy is not a WAL parser or proof
 * that transient stores did not occur. Images remain the authority for exact bytes.
 */
import type { IFileImage, ISourceImage } from './images.js';

/** Fixture and runtime witnesses establish these facts before a coordination allowance is considered. @internal */
export interface IHealthyWalLayout {
    readonly kind: 'healthy-wal';
    readonly ownership: 'closed-clean' | 'retained' | 'live-owner';
    readonly pageSize: 4096;
    readonly databasePages: 1 | 2 | 3;
    readonly nativeByteOrder: 'LE' | 'BE';
}
/** Missing fixture/layout proof grants no native sidecar allowance. @internal */
export interface IUnprovedLayout { readonly kind: 'unproved'; }
/** Case labels never substitute for established healthy-layout witnesses. @internal */
export type IEstablishedLayout = IHealthyWalLayout | IUnprovedLayout;
/** A reader-only interval excludes owner SQL; its ending phase is independent of a proved attachment inside these exact boundaries. @internal */
export interface IEffectStageContext {
    readonly readerOnly: boolean;
    readonly stage: 'open' | 'begin' | 'anchor' | 'read' | 'runtime' | 'end' | 'close' | 'exit';
    /** True only for a proved in-interval opportunity: a successful causal prefix or Q13's exact expected fixed-query refusal, with prior-owner/layout proof. */
    readonly firstAttachment: boolean;
}
/** Half-open byte intervals distinguish changed content from absent/added tails without copying proof bytes. @internal */
export interface IChangedRange { readonly start: number; readonly end: number; }
/** Observed pathname identity, size and hash refer to the corresponding retained source image. @internal */
export interface IEffectFileFacts {
    readonly dev: number;
    readonly ino: number;
    readonly size: number;
    readonly sha256: string;
}
/** Each annotation retains exact sampled differences and both observed identities independently of its disposition. @internal */
export interface IEffectObservation {
    readonly file: string;
    readonly reason: string;
    readonly before: IEffectFileFacts | null;
    readonly after: IEffectFileFacts | null;
    readonly changedRanges: readonly IChangedRange[];
}
/** Unknown effects stop automatic qualification; they are never merged into known coordination. @internal */
export interface IEffectsClassification {
    readonly allowed: readonly IEffectObservation[];
    readonly forbidden: readonly IEffectObservation[];
    readonly unknown: readonly IEffectObservation[];
}
/** Installed sqlite3.c WalIndexHdr/WalCkptInfo and WALINDEX_PGSZ define one 32KiB region with a 136-byte header. */
const indexRegionBytes = 32768;
/** The ordinary source allocation and selected default page size bound this recognizer to at most 63 frames. */
const maximumFrames = 63;
/** The selected ordinary source sum remains unchanged; Q15 hot DELETE has no WAL coordination allowance. */
const ordinarySourceBytes = 256 * 1024;
/** The installed native wal-index format uses this version in both independently checksummed headers. */
const indexVersion = 3007000;
/** The fixed WAL header version is distinct from its wal-index representation, even though the installed versions share a number. */
const walVersion = 3007000;
/** Unused reader slots use this sentinel; OS lock bytes at 120..127 are never content stores. */
const unusedReadMark = 0xffffffff;

/** Report exact contiguous differences, including creation/removal tails; equality never trusts a supplied hash alone. */
function ranges(before: Buffer | undefined, after: Buffer | undefined): IChangedRange[] {
    const result: IChangedRange[] = [];
    const length = Math.max(before?.length ?? 0, after?.length ?? 0);
    let start: number | undefined;
    for (let offset = 0; offset < length; offset++) {
        if (before?.[offset] !== after?.[offset]) {
            start ??= offset;
        } else if (start !== undefined) {
            result.push({ start, end: offset });
            start = undefined;
        }
    }
    if (start !== undefined) { result.push({ start, end: length }); }
    return result;
}
/** File summaries retain measured identity rather than inferring replacement from byte equality. */
function facts(file: IFileImage | undefined): IEffectFileFacts | null {
    return file ? { dev: file.dev, ino: file.ino, size: file.bytes.length, sha256: file.sha256 } : null;
}
/** Every effect keeps the original image references expressible through its filename and hashes. */
function observation(file: string, reason: string, before: IFileImage | undefined, after: IFileImage | undefined): IEffectObservation {
    return { file, reason, before: facts(before), after: facts(after), changedRanges: ranges(before?.bytes, after?.bytes) };
}
/** Wal-index integers are native order; the actual runtime witness supplies that order without architecture guessing. */
function word(bytes: Buffer, offset: number, layout: IHealthyWalLayout): number {
    return layout.nativeByteOrder === 'LE' ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
}
/** Hash table slots and szPage use the same measured native byte order as the header. */
function short(bytes: Buffer, offset: number, layout: IHealthyWalLayout): number {
    return layout.nativeByteOrder === 'LE' ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
}
/** Installed walChecksumBytes(native=1) checks the first forty header bytes using paired unsigned additions. */
function checksumMatches(bytes: Buffer, layout: IHealthyWalLayout): boolean {
    let first = 0, second = 0;
    for (let offset = 0; offset < 40; offset += 8) {
        first = (first + word(bytes, offset, layout) + second) >>> 0;
        second = (second + word(bytes, offset + 4, layout) + first) >>> 0;
    }
    return word(bytes, 40, layout) === first && word(bytes, 44, layout) === second;
}
/** Baseline header/size witnesses corroborate only the selected healthy WAL layout, never application schema identity. */
function healthyMain(file: IFileImage | undefined, layout: IHealthyWalLayout): boolean {
    if (!file || file.bytes.length !== layout.databasePages * layout.pageSize) { return false; }
    return file.bytes.subarray(0, 16).equals(Buffer.from('SQLite format 3\0', 'binary')) && file.bytes.readUInt16BE(16) === layout.pageSize && file.bytes[18] === 2 && file.bytes[19] === 2 && file.bytes.readUInt32BE(28) === layout.databasePages;
}
/** Only the selected healthy cases admit WAL coordination; Q13 remains a foreign, query-inapplicable two-page database. */
function eligible(caseId: string, layout: IEstablishedLayout, before: ISourceImage, after: ISourceImage): layout is IHealthyWalLayout {
    if (layout.kind !== 'healthy-wal' || ['Q11', 'Q12', 'Q14', 'Q15'].includes(caseId) || before.totalBytes > ordinarySourceBytes || after.totalBytes > ordinarySourceBytes) { return false; }
    if (caseId === 'Q13' && (layout.ownership !== 'closed-clean' || layout.databasePages > 2)) { return false; }
    return healthyMain(before.files.find(file => file.name === 'store.sqlite'), layout);
}
/**
 * Recognize one complete stable index, not arbitrary bytes within a familiar file size.
 * sqlite3.c:67712..67860 defines duplicate headers, checkpoint/read marks and reserved
 * locks; :68007..68031 and :68691..68736 define the page map and 383/probing hash.
 * A stale/uncommitted tail outside this finite shape remains unknown.
 */
function knownIndex(bytes: Buffer, layout: IHealthyWalLayout): boolean {
    if (bytes.length !== indexRegionBytes || !bytes.subarray(0, 48).equals(bytes.subarray(48, 96)) || word(bytes, 0, layout) !== indexVersion || word(bytes, 4, layout) !== 0 || bytes[12] !== 1 || (bytes[13] !== 0 && bytes[13] !== 1) || !checksumMatches(bytes, layout)) { return false; }
    const frames = word(bytes, 16, layout);
    const pages = word(bytes, 20, layout);
    if (frames > maximumFrames || (frames === 0 ? pages !== 0 || short(bytes, 14, layout) !== 0 : pages !== layout.databasePages || short(bytes, 14, layout) !== layout.pageSize)) { return false; }
    const backfill = word(bytes, 96, layout), attempted = word(bytes, 128, layout);
    if (backfill > attempted || attempted > frames || word(bytes, 100, layout) !== 0 || !bytes.subarray(120, 128).equals(Buffer.alloc(8)) || word(bytes, 132, layout) !== 0) { return false; }
    for (let slot = 1; slot < 5; slot++) {
        const mark = word(bytes, 100 + slot * 4, layout);
        if (mark !== unusedReadMark && mark > frames) { return false; }
    }
    const expectedHash = new Uint16Array(8192);
    for (let frame = 0; frame < frames; frame++) {
        const page = word(bytes, 136 + frame * 4, layout);
        if (page < 1 || page > layout.databasePages) { return false; }
        let slot = (page * 383) % 8192;
        while (expectedHash[slot] !== 0) { slot = (slot + 1) % 8192; }
        expectedHash[slot] = frame + 1;
    }
    if (!bytes.subarray(136 + frames * 4, 16384).equals(Buffer.alloc(16384 - 136 - frames * 4))) { return false; }
    for (let slot = 0; slot < 8192; slot++) {
        if (short(bytes, 16384 + slot * 2, layout) !== expectedHash[slot]) { return false; }
    }
    return true;
}
/** Empty-WAL walIndexRecover (:68800,:68957..68983) publishes exactly zero header state plus the version/init/checksum and unused marks. */
function emptyIndex(bytes: Buffer, layout: IHealthyWalLayout): boolean {
    if (!knownIndex(bytes, layout) || word(bytes, 8, layout) !== 0 || word(bytes, 16, layout) !== 0 || bytes[13] !== 0 || !bytes.subarray(24, 40).equals(Buffer.alloc(16))) { return false; }
    for (let slot = 1; slot < 5; slot++) {
        if (word(bytes, 100 + slot * 4, layout) !== unusedReadMark) { return false; }
    }
    return true;
}
/** One reader may set one unused/older mark to its unchanged mxFrame; headers, checkpoint state, map and OS lock bytes remain identical. */
function readMarkOnly(before: Buffer, after: Buffer, layout: IHealthyWalLayout): boolean {
    if (!knownIndex(before, layout) || !knownIndex(after, layout) || !before.subarray(0, 104).equals(after.subarray(0, 104)) || !before.subarray(120).equals(after.subarray(120))) { return false; }
    const frame = word(before, 16, layout);
    let changed = 0;
    for (let slot = 1; slot < 5; slot++) {
        const old = word(before, 100 + slot * 4, layout), fresh = word(after, 100 + slot * 4, layout);
        if (old !== fresh) {
            if (frame === 0 || fresh !== frame || (old !== unusedReadMark && old >= frame)) { return false; }
            changed++;
        }
    }
    return changed === 1;
}
/** Native rolling checksum state covers the fixed header/frame spans without retaining another source copy. */
interface IChecksum { readonly first: number; readonly second: number; }
/** The WAL magic selects checksum word order independently of the measured host's wal-index byte order. */
function walChecksum(bytes: Buffer, start: number, end: number, order: 'LE' | 'BE', initial: IChecksum): IChecksum {
    let first = initial.first, second = initial.second;
    for (let offset = start; offset < end; offset += 8) {
        const a = order === 'LE' ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
        const b = order === 'LE' ? bytes.readUInt32LE(offset + 4) : bytes.readUInt32BE(offset + 4);
        first = (first + a + second) >>> 0;
        second = (second + b + first) >>> 0;
    }
    return { first, second };
}
/**
 * Recognize Q7's fixed, wholly committed retained WAL reconstruction only: 4096-byte
 * frames, <=3 database pages, <=63 frames, one exact index region and no tail.
 * sqlite3.c:68355..68449 defines frame fields/salt/rolling checksums;
 * :68817..68983 defines header validation, page-map recovery, final commit header
 * and reset checkpoint/read marks. Any other format, dirty tail, partial frame or
 * unexpected recovered state remains unknown; this supplies no general WAL API.
 */
function retainedReconstruction(wal: Buffer, index: Buffer, layout: IHealthyWalLayout): boolean {
    const frameBytes = layout.pageSize + 24;
    if (wal.length < 32 + frameBytes || wal.length > ordinarySourceBytes || (wal.length - 32) % frameBytes !== 0) { return false; }
    const frames = (wal.length - 32) / frameBytes;
    if (frames > maximumFrames || !knownIndex(index, layout) || word(index, 8, layout) !== 0 || word(index, 16, layout) !== frames || word(index, 96, layout) !== 0 || word(index, 128, layout) !== frames || word(index, 104, layout) !== frames) { return false; }
    const magic = wal.readUInt32BE(0);
    if ((magic !== 0x377f0682 && magic !== 0x377f0683) || wal.readUInt32BE(4) !== walVersion || wal.readUInt32BE(8) !== layout.pageSize || index[13] !== (magic & 1) || !index.subarray(32, 40).equals(wal.subarray(16, 24))) { return false; }
    const order = (magic & 1) === 0 ? 'LE' : 'BE';
    let checksum = walChecksum(wal, 0, 24, order, { first: 0, second: 0 });
    if (checksum.first !== wal.readUInt32BE(24) || checksum.second !== wal.readUInt32BE(28)) { return false; }
    for (let frame = 0; frame < frames; frame++) {
        const offset = 32 + frame * frameBytes;
        const page = wal.readUInt32BE(offset), commit = wal.readUInt32BE(offset + 4);
        if (page < 1 || page > layout.databasePages || commit > layout.databasePages || (frame === frames - 1 && commit !== layout.databasePages) || !wal.subarray(offset + 8, offset + 16).equals(wal.subarray(16, 24)) || word(index, 136 + frame * 4, layout) !== page) { return false; }
        checksum = walChecksum(wal, offset, offset + 8, order, checksum);
        checksum = walChecksum(wal, offset + 24, offset + frameBytes, order, checksum);
        if (checksum.first !== wal.readUInt32BE(offset + 16) || checksum.second !== wal.readUInt32BE(offset + 20)) { return false; }
    }
    if (word(index, 24, layout) !== checksum.first || word(index, 28, layout) !== checksum.second) { return false; }
    for (let slot = 2; slot < 5; slot++) {
        if (word(index, 100 + slot * 4, layout) !== unusedReadMark) { return false; }
    }
    return true;
}
/** Recognize only source-grounded finite first-attachment/recovery/read-mark transitions; additional behavior remains unknown. */
function shmReason(layout: IHealthyWalLayout, context: IEffectStageContext, before: IFileImage | undefined, after: IFileImage, wal: IFileImage | undefined): { readonly allowed: boolean; readonly reason: string } {
    if (!wal) { return { allowed: false, reason: 'SHM transition has no observed WAL entry for the claimed WAL-index layout' }; }
    const canAttach = context.firstAttachment && layout.ownership !== 'live-owner';
    if (after.bytes.length === 3) {
        const prefix = before ? before.bytes.subarray(0, 3) : Buffer.alloc(3);
        if (canAttach && (!before || before.bytes.length === 3 || knownIndex(before.bytes, layout)) && after.bytes.equals(prefix)) {
            return { allowed: true, reason: before ? 'known Unix first-attacher truncate to preserved three-byte prefix' : 'known Unix first-attacher three-byte zero initialization' };
        }
        return { allowed: false, reason: 'three-byte SHM lacks proved first-attacher interval, ownership or preserved prefix' };
    }
    if (after.bytes.length !== indexRegionBytes || !knownIndex(after.bytes, layout)) { return { allowed: false, reason: 'unrecognized SHM size or complete one-region header/map/hash layout' }; }
    if (before?.bytes.length === indexRegionBytes && ['anchor', 'read', 'runtime'].includes(context.stage) && readMarkOnly(before.bytes, after.bytes, layout)) {
        return { allowed: true, reason: 'known single reader-mark advance to stable committed frame' };
    }
    if (!canAttach || (before && before.bytes.length !== 3 && !knownIndex(before.bytes, layout))) { return { allowed: false, reason: 'SHM content change lacks recognized first-attacher or read-mark transition' }; }
    if (wal && wal.bytes.length > 0) {
        return retainedReconstruction(wal.bytes, after.bytes, layout)
            ? { allowed: true, reason: 'known finite committed retained-WAL index reconstruction with validated salts/checksums/page map' }
            : { allowed: false, reason: 'retained-WAL SHM reconstruction differs from fixed committed frame/checksum/map/checkpoint shape' };
    }
    if (emptyIndex(after.bytes, layout)) { return { allowed: true, reason: 'known exact empty-WAL first-region index initialization/reconstruction' }; }
    return { allowed: false, reason: 'SHM initialization differs from exact empty-WAL index shape' };
}

/**
 * Classify adjacent, paused-modifier reader images without promoting unknown effects.
 * Q13 receives known closed-WAL coordination only with actual foreign-valid layout
 * proof; its application-query failure remains an independent required outcome.
 * Main/committed-WAL/journal preservation and sidecar identities remain invariant.
 * @internal
 */
export function classifyEffects(caseId: string, establishedLayout: IEstablishedLayout, stageContext: IEffectStageContext, before: ISourceImage, after: ISourceImage): IEffectsClassification {
    const allowed: IEffectObservation[] = [], forbidden: IEffectObservation[] = [], unknown: IEffectObservation[] = [];
    const old = new Map(before.files.map(file => [file.name, file]));
    const fresh = new Map(after.files.map(file => [file.name, file]));
    for (const name of new Set([...old.keys(), ...fresh.keys()])) {
        const a = old.get(name), b = fresh.get(name);
        if (a && b && a.dev === b.dev && a.ino === b.ino && a.bytes.equals(b.bytes)) { continue; }
        if (!stageContext.readerOnly) { unknown.push(observation(name, 'effect occurs outside a proved reader-only attribution window', a, b)); continue; }
        if (!['store.sqlite', 'store.sqlite-wal', 'store.sqlite-shm', 'store.sqlite-journal'].includes(name)) { forbidden.push(observation(name, 'unselected directory entry creation/change/removal', a, b)); continue; }
        if (a && (!b || a.dev !== b.dev || a.ino !== b.ino)) { forbidden.push(observation(name, b ? 'source entry replacement' : 'source entry disappearance', a, b)); continue; }
        if (name === 'store.sqlite-shm' && b) {
            if (!eligible(caseId, establishedLayout, before, after)) { unknown.push(observation(name, 'SHM coordination lacks proved selected healthy WAL layout', a, b)); continue; }
            const disposition = shmReason(establishedLayout, stageContext, a, b, fresh.get('store.sqlite-wal'));
            (disposition.allowed ? allowed : unknown).push(observation(name, disposition.reason, a, b));
            continue;
        }
        if (name === 'store.sqlite-wal' && !a && b && b.bytes.length === 0) {
            if (eligible(caseId, establishedLayout, before, after) && establishedLayout.ownership === 'closed-clean' && stageContext.firstAttachment && ['open', 'begin', 'anchor'].includes(stageContext.stage)) { allowed.push(observation(name, 'known empty WAL creation in proved healthy closed WAL layout', a, b)); }
            else { unknown.push(observation(name, 'empty WAL creation lacks proved healthy closed WAL stage/layout allowance', a, b)); }
            continue;
        }
        forbidden.push(observation(name, name === 'store.sqlite' ? 'main creation or bytes changed' : name === 'store.sqlite-wal' && !a ? 'new nonempty WAL' : `${name} creation or bytes changed`, a, b));
    }
    return { allowed, forbidden, unknown };
}
