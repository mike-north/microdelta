/** Once-only finite qualification coordinator. Importing this file opens no database and launches no process. */
import { appendFile, chmod, lstat, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { ICell } from '../src/evidence.js';
import { bounds } from '../src/protocol.js';
import { ExecutionScope, withCaseBudget, caseBoundaryReason } from './deadline.js';
import type { IExpirationState } from './deadline.js';
import { publishEvent, eventFailures } from './runtime-events.js';
import { completeVerification, terminalVerdict } from './completion.js';
import { Peer, record } from './peer.js';
import { askStage, retainMeasurement, observeReply, observePhysical } from './receipts.js';
import { caseEffects } from './case-effects.js';
import { effectIntervalContext } from './effect-interval.js';
import type { ICaseBaseline } from './case-effects.js';
import type { IEstablishedLayout, IEffectObservation } from './effects-policy.js';
import { establishLayout } from './layout.js';
import { assessEffectsControl } from './effects-control.js';
import type { IDeletionObservation } from './effects-control.js';
import { sourceImage, remainingImageBytes } from './images.js';
import type { ISourceImage, IFileImage } from './images.js';
import { evaluateCell, profileObserved } from './oracle.js';
import type { IStageRecord } from './oracle.js';
import { imageBarriers, selectedLedger, validateLedger } from './schedule.js';
import type { ILedgerRow } from './schedule.js';
import { withMeasurementOwners, settleOwners } from './ownership.js';
import { rawMeasurementPort } from './measurement.js';
import type { IRetainedMeasurement, IMeasurementBudget } from './measurement.js';
import { verifyManifest } from './freeze.js';
import type { IManifest } from './freeze.js';
/** Categories implement the conservative 125.875MiB allocation; deduplication never enlarges these ceilings. */
const limits = { ordinary: 66 * 1048576, hot: 48 * 1048576, raw: 47 * 131072, pins: 4 * 1048576, structured: 1280 * 1024 } as const;
/** Persisted proof is counted before writes, preserving overflow as a harness failure rather than truncated validity. @internal */
export class ProofBudget {
    /** Counters survive persistence failure and retain the amount that triggered an overflow. @internal */
    public readonly used = { ordinary: 0, hot: 0, raw: 0, pins: 0, structured: 0 };
    /** No category or global ceiling may be silently expanded by a caller. @internal */
    public reserve(category: keyof typeof limits, bytes: number): void {
        if (!Number.isSafeInteger(bytes) || bytes < 0) {
            throw new Error('Invalid retained proof amount');
        }
        this.used[category] += bytes;
        if (this.used[category] > limits[category] || Object.values(this.used).reduce((a, b) => a + b, 0) > 128 * 1048576) {
            throw new Error(`Retained proof quota exceeded: ${category}`);
        }
    }
    /** A stalled proof write remains an asynchronous stage so the independent outer can still cancel/reap ownership. @internal */
    public constructor(private readonly scope?: ExecutionScope) { }
    /** Record exact bytes only after category/global admission, using the same finite stage budget as other I/O. @internal */
    public async write(path: string, bytes: string | Uint8Array, category: keyof typeof limits, append = false): Promise<void> {
        this.reserve(category, typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength);
        const operation = async (): Promise<void> => {
            if (append) {
                await appendFile(path, bytes);
            }
            else {
                await writeFile(path, bytes, { flag: 'wx' });
            }
        };
        if (this.scope) {
            await this.scope.stage(`proof ${basename(path)}`, operation);
        }
        else {
            await operation();
        }
    }
}
/** Finite summary formatting cannot traverse arbitrary native/caller error graphs. */
function errorFacts(error: unknown): unknown { return { type: error instanceof Error ? error.name : typeof error, message: (error instanceof Error ? error.message : String(error)).slice(0, 1024) }; }
/** Images are proof siblings of sources and are never opened as SQLite databases. */
interface IBarrier {
    readonly label: string;
    readonly stages: readonly string[];
    readonly attribution: 'reader-only' | 'owner-or-fixture';
    readonly image: ISourceImage;
    /** The reached-record cut excludes all activity at or before this complete image. */
    readonly recordCount: number;
}
/** A cell retains counterexample dimensions separately from cleanup and harness status. */
interface ICellProof {
    readonly id: string;
    readonly conclusion: ICell;
    readonly records: readonly IStageRecord[];
    readonly images: readonly unknown[];
    readonly effects: readonly string[];
    readonly failures: readonly unknown[];
    readonly measurementClosure: unknown;
    readonly fixtureReady: boolean;
    readonly control?: unknown;
    readonly physicalEffects?: unknown;
}
/** Absolute campaign cancellation remains sticky across successful cleanup and later rows. */
interface ICampaign extends IExpirationState {
    deadlineAt: number;
    stopped?: boolean;
    launches: number;
    requests: number;
    measurement: 'not-started' | 'acquiring' | 'owned' | 'closed' | 'unresolved';
}
/** The independent outer observes pending acquisition as uncertainty, never definite absence. */
function measurementState(campaign: ICampaign, state: ICampaign['measurement']): void {
    campaign.measurement = state;
    if (state !== 'not-started') {
        publishEvent({ kind: 'measurement', state });
    }
}
/** Every deadline requests the same invocation stop and publishes pending stages before cleanup can block. */
function expired(label: string, pending: readonly string[]): void { publishEvent({ kind: 'expired', label, at: Date.now(), pendingStages: pending }); }
/** Every rejected cleanup remains secondary; all registered owned processes are still attempted. */
async function abortAll(peers: Iterable<Peer>): Promise<unknown[]> { return settleOwners(peers); }
/** Existing-file byte/header witnesses establish each intended WAL or hot-journal layout before candidate attribution. */
function file(image: ISourceImage | undefined, name: string): Buffer | undefined { return image?.files.find(value => value.name === name)?.bytes; }
/** These bounds reject synthetic suffix-only or unspilled hot fixtures without opening a writable repair connection. */
function hotReady(clean: ISourceImage | undefined, dirty: ISourceImage | undefined): boolean {
    const main = file(dirty, 'store.sqlite'), journal = file(dirty, 'store.sqlite-journal'), old = file(clean, 'store.sqlite');
    if (!main || !journal || !old || journal.length < 28 || main.length < 100 || main.equals(old) || journal.subarray(0, 8).toString('hex') !== 'd9d505f920a163d7') {
        return false;
    }
    const sector = journal.readUInt32BE(20), page = journal.readUInt32BE(24), original = journal.readUInt32BE(16);
    const mainPage = main.readUInt16BE(16) === 1 ? 65536 : main.readUInt16BE(16);
    return page === mainPage && page >= 512 && page <= 65536 && (page & (page - 1)) === 0 && sector >= 512 && sector <= 65536 && (sector & (sector - 1)) === 0 && original > 0 && original * page === old.length && journal.length >= sector + page + 8;
}
/** Fixture permissions are applied only on disposable paths outside reader attribution. */
async function prepareModes(id: string, source: string): Promise<void> {
    if (!['Q6', 'Q7', 'Q8', 'Q9', 'Q10'].includes(id)) {
        return;
    }
    for (const suffix of ['', ...(id === 'Q10' ? [] : ['-wal']), ...(id === 'Q6' ? ['-shm'] : [])]) {
        await chmod(join(source, 'store.sqlite') + suffix, 0o444);
    }
    if (id === 'Q9') {
        await chmod(join(source, 'store.sqlite-shm'), 0);
    }
    await chmod(source, id === 'Q7' ? 0o700 : 0o555);
}
/** Restoration follows every native owner exit and resolved measurement closure, never occurs in an attributed window. */
async function restoreModes(source: string): Promise<void> {
    await chmod(source, 0o700);
    for (const name of await readdir(source)) {
        const path = join(source, name);
        const stat = await lstat(path);
        if (stat.isFile()) {
            await chmod(path, 0o600);
        }
    }
}
/** The coordinator-only effects control also records a deliberately missed write/restore between image barriers. */
/** Four exact images plus one distinct pathname-deletion receipt exercise the selected control without SQLite. @internal */
export async function effectControl(source: string, proof: string, budget: ProofBudget, hooks: {
    readonly recreate?: (path: string, bytes: Buffer) => Promise<void>;
} = {}): Promise<ICellProof> {
    const images: ISourceImage[] = [];
    const failures: unknown[] = [];
    let deletion: IDeletionObservation | undefined;
    try {
        await writeFile(join(source, 'store.sqlite'), Buffer.alloc(16, 0x11));
        images.push(await sourceImage(source, 262144));
        await writeFile(join(source, 'store.sqlite'), Buffer.alloc(16, 0x22));
        await writeFile(join(source, 'extra-sidecar'), Buffer.alloc(16, 1));
        images.push(await sourceImage(source, 262144));
        await unlink(join(source, 'extra-sidecar'));
        await unlink(join(source, 'store.sqlite'));
        try {
            await lstat(join(source, 'store.sqlite'));
            deletion = { kind: 'present' };
        }
        catch (error: unknown) {
            deletion = record(error) && error.code === 'ENOENT' ? { kind: 'missing', code: 'ENOENT' } : { kind: 'failed', code: record(error) && typeof error.code === 'string' ? error.code : null };
        }
        await (hooks.recreate ?? writeFile)(join(source, 'store.sqlite'), Buffer.alloc(16, 0x11));
        images.push(await sourceImage(source, 262144));
        await writeFile(join(source, 'store.sqlite'), Buffer.alloc(16, 0x22));
        await writeFile(join(source, 'transient'), Buffer.alloc(1));
        await writeFile(join(source, 'store.sqlite'), Buffer.alloc(16, 0x11));
        await unlink(join(source, 'transient'));
        images.push(await sourceImage(source, 262144));
    }
    catch (error: unknown) {
        failures.push(error);
    }
    const assessment = assessEffectsControl(images[0], images[1], deletion, images[2], images[3]);
    // Establish every observed fact before any proof write can fail. These small control bytes remain in the returned record too.
    const control = { ...assessment, deletion, imageBytes: images.map(image => image.files.map(file => ({ name: file.name, bytes: [...file.bytes], dev: file.dev, ino: file.ino }))) };
    try {
        for (const [index, image] of images.entries()) {
            for (const value of image.files) {
                await budget.write(join(proof, `image-${index}-${value.name}`), value.bytes, 'ordinary');
            }
        }
        await budget.write(join(proof, 'deletion-observation.json'), JSON.stringify(deletion ?? { kind: 'unobserved' }), 'structured');
    }
    catch (error: unknown) {
        failures.push(error);
    }
    return { id: 'C-forbidden-effects', conclusion: { id: 'C-forbidden-effects', outcome: assessment.observed && failures.length === 0 ? 'observed' : 'unproved', pins: true, cleanup: failures.length === 0, measurement: images.length === 4 }, records: [], images: images.map(image => ({ files: image.files.map(value => ({ name: value.name, sha256: value.sha256, size: value.bytes.length, dev: value.dev, ino: value.ino })) })), effects: [], failures: failures.map(errorFacts), measurementClosure: null, fixtureReady: true, control };
}
/** Every case/control budget begins before directories, fixture bytes or images exist. */
async function runCell(row: ILedgerRow, output: string, registry: Set<Peer>, budget: ProofBudget, campaign: ICampaign): Promise<ICellProof> {
    const failures: unknown[] = [];
    let returned: ICellProof | undefined;
    const source = join(output, 'source', row.id), proof = join(output, 'proof', row.id);
    try {
        return await withCaseBudget(async (scope) => {
            await mkdir(source, { recursive: true, mode: 0o700 });
            scope.assert();
            await mkdir(proof, { recursive: true });
            scope.assert();
            if (row.id === 'Q12') {
                await writeFile(join(source, 'store.sqlite'), new Uint8Array());
            }
            if (row.id === 'Q14') {
                await writeFile(join(source, 'store.sqlite'), Buffer.alloc(512, 0x7f));
            }
        }, async (scope) => { returned = await runCellBody(row, output, registry, budget, campaign, scope, failures); return returned; }, { milliseconds: Math.max(0, Math.min(bounds.caseMilliseconds, campaign.deadlineAt - Date.now())), shared: campaign, owners: () => registry, failures, label: row.id, stageMilliseconds: bounds.stageMilliseconds, notify: expired });
    }
    catch (error: unknown) {
        failures.push(error);
        if (returned) {
            return { ...returned, conclusion: { ...returned.conclusion, outcome: returned.conclusion.outcome === 'counterexample' ? 'counterexample' : 'unproved', cleanup: false }, failures: [...returned.failures, ...failures.map(errorFacts)] };
        }
        return { id: row.id, conclusion: { id: row.id, outcome: 'unproved', pins: false, cleanup: [...registry].every(peer => !peer.running), measurement: false }, records: [], images: [], effects: [], failures: failures.map(errorFacts), measurementClosure: null, fixtureReady: false };
    }
}
/** Execute one reviewed longest-branch schedule; expected native refusals only skip declared conditional data actions. */
async function runCellBody(row: ILedgerRow, output: string, registry: Set<Peer>, budget: ProofBudget, campaign: ICampaign, scope: ExecutionScope, failures: unknown[]): Promise<ICellProof> {
    const source = join(output, 'source', row.id), proof = join(output, 'proof', row.id);
    if (row.id === 'C-forbidden-effects') {
        return scope.stage('effects control', () => effectControl(source, proof, budget));
    }
    const peers = new Map<string, Peer>(), records: IStageRecord[] = [], barriers: IBarrier[] = [], effects: string[] = [];
    const count = { value: 0 };
    let interval: string[] = [];
    const imageAttempts: {
        label: string;
        stages: readonly string[];
        attribution: string;
        complete: boolean;
        metadata: string;
    }[] = [];
    let establishedLayout: IEstablishedLayout = { kind: 'unproved' };
    let caseBaseline: ICaseBaseline = { proved: false, image: undefined };
    const physicalEffects: {
        allowed: IEffectObservation[];
        forbidden: IEffectObservation[];
        unknown: IEffectObservation[];
    } = { allowed: [], forbidden: [], unknown: [] };
    let writerExited = false;
    let fixtureReady = true, measurementClosure: unknown = null, measurement: IRetainedMeasurement | undefined, measurementAccount: IMeasurementBudget | undefined, modesPrepared = false;
    let launched = 0;
    const started = performance.now();
    /** Deadline kills owned children; the same sequential scope still awaits their actual exits and raw descriptor closure. */
    /** Every filesystem or protocol boundary consumes the shared case/coordinator time, not a fresh setup allowance. */
    function deadline(): void {
        scope.assert();
        const reason = caseBoundaryReason(campaign, performance.now() - started, bounds.caseMilliseconds);
        if (reason !== undefined) { throw new Error(reason); }
    }
    /** Capture current exact source bytes under the existing slot; Q9 partial descriptor evidence is persisted before failure. */
    async function image(label: string): Promise<void> {
        deadline();
        if (imageAttempts.length >= row.maximumImages) {
            throw new Error('Image slot quota exceeded');
        }
        const index = imageAttempts.length;
        const stages = interval;
        interval = [];
        const attribution = stages.every(stage => /^(?:R|R2)\./u.test(stage) || row.id === 'C-false-release' && stage.startsWith('C.')) ? 'reader-only' : 'owner-or-fixture';
        let observedMeasurement: unknown;
        const retainedFiles: IFileImage[] = [];
        const attempt = { label, stages, attribution, complete: false, metadata: `image-${index}.json` };
        imageAttempts.push(attempt);
        const retainedMeasurement = measurement;
        let shmBytes: Buffer | undefined;
        let shmComplete = true;
        if (retainedMeasurement) {
            if (!measurementAccount) {
                throw new Error('Missing aggregate measurement account');
            }
            measurementAccount.maxImageBytes = await remainingImageBytes(source, 262144, 2097152);
            const value = await retainedMeasurement.capture(label);
            shmBytes = Buffer.from(value.bytes);
            shmComplete = value.complete;
            observedMeasurement = { ...value, bytes: undefined, bytesRead: value.bytes.byteLength };
            const receipt = await retainMeasurement(value, attribution === 'reader-only', bytes => budget.write(join(proof, `image-${index}-partial-shm`), bytes, 'ordinary'), observed => {
                effects.push(...observed.forbidden);
                observePhysical(row.id, observed.forbidden, observed.image.complete ? [] : observed.image.issues, { state: campaign.measurement, complete: observed.image.complete, bytesRead: observed.image.bytes.byteLength, observations: observed.image.observations }, { attribution, stage: label });
            });
            failures.push(...receipt.failures);
            if (receipt.failures.length) {
                throw receipt.failures[0];
            }
        }
        let current: ISourceImage | undefined;
        let imagingFailed = false;
        try {
            const retained = retainedMeasurement ? async (): Promise<Buffer> => {
                if (!shmComplete || !shmBytes) {
                    throw new Error('Incomplete retained SHM image');
                }
                return shmBytes;
            } : undefined;
            current = await scope.stage('source image', () => sourceImage(source, row.id === 'Q15' ? 8 * 1048576 : 262144, retained, value => { retainedFiles.push(value); }));
            if (!shmComplete) {
                throw new Error('Incomplete retained SHM image');
            }
            const previous = barriers.at(-1);
            if (previous && attribution === 'reader-only') {
                const context = effectIntervalContext({ caseId: row.id, captureLabel: label, stages, beforeRecordCount: previous.recordCount, records, expectedStages: row.orderedCommands, fixtureReady, layout: establishedLayout });
                const classification = caseEffects(row.id, establishedLayout, context, caseBaseline, previous.image, current);
                physicalEffects.allowed.push(...classification.allowed);
                physicalEffects.forbidden.push(...classification.forbidden);
                physicalEffects.unknown.push(...classification.unknown);
                effects.push(...classification.forbidden.map(value => `${value.file}: ${value.reason}`));
                if (classification.unknown.length || classification.forbidden.length) {
                    campaign.stopped = true;
                    campaign.reason = classification.forbidden.length ? 'Observed forbidden physical effect' : 'Unknown physical effect requires root disposition';
                }
                observePhysical(row.id, classification.forbidden.map(value => `${value.file}: ${value.reason}`), classification.unknown.map(value => `${value.file}: ${value.reason}`), { state: campaign.measurement }, { attribution, stage: label });
            }
            barriers.push({ label, stages, attribution, image: current, recordCount: records.length });
            attempt.complete = true;
            for (const value of retainedFiles) {
                await budget.write(join(proof, `image-${index}-${value.name}`), value.bytes, row.id === 'Q15' ? 'hot' : 'ordinary');
            }
        }
        catch (error: unknown) {
            imagingFailed = true;
            throw error;
        }
        finally {
            try {
                await budget.write(join(proof, `image-${index}.json`), JSON.stringify({ label, stages, attribution, complete: !imagingFailed, measurement: observedMeasurement, files: retainedFiles.map(value => ({ name: value.name, size: value.bytes.length, sha256: value.sha256, dev: value.dev, ino: value.ino })) }), 'structured');
            }
            catch (error: unknown) {
                if (imagingFailed) {
                    failures.push(error);
                }
                else {
                    throw error;
                }
            }
        }
    }
    /** Native owner kills are fixture construction, never counted as successful reader release. */
    async function killWriter(): Promise<void> {
        const writer = peers.get('W');
        if (!writer) {
            throw new Error('Missing fixture writer');
        }
        const exit = await writer.killFixture();
        writerExited = true;
        if (exit.signal !== 'SIGKILL') {
            throw new Error('Fixture writer kill not observed');
        }
        interval.push('fixture.owner-kill-actual-exit');
        await image('owner-killed');
    }
    /** Only Q7/Q8 remove SHM, after actual writer exit, preserving main/WAL bytes. */
    async function layout(): Promise<void> {
        if (['Q7', 'Q8', 'Q9'].includes(row.id)) {
            await killWriter();
            if (row.id !== 'Q9') {
                await unlink(join(source, 'store.sqlite-shm'));
            }
        }
        if (row.id === 'Q15') {
            const clean = barriers.find(value => value.label === 'W.hot-seedA')?.image, dirty = barriers.find(value => value.label === 'W.hold-spilled-update')?.image;
            fixtureReady = hotReady(clean, dirty);
            await killWriter();
            if (!fixtureReady) {
                throw new Error('Genuine hot-journal fixture unproved');
            }
        }
    }
    /** Exact actual command order is preserved even when conditional stages report skipped after a native refusal. */
    async function sequence(start: number): Promise<void> {
        for (let index = start; index < row.orderedCommands.length; index++) {
            deadline();
            const stage = row.orderedCommands[index];
            if (!stage) {
                throw new Error('Missing ledger stage');
            }
            const dot = stage.indexOf('.'), role = stage.slice(0, dot), action = stage.slice(dot + 1);
            if (stage === 'R.profile' && !modesPrepared) {
                await scope.stage('fixture layout', layout);
                scope.assert();
                if (row.id === 'Q9' && !measurement) {
                    measurementAccount = { imagesUsed: 0, bytesUsed: 0, maxImages: row.maximumImages, maxBytes: row.maximumImages * 262144, maxFileBytes: 2097152, maxImageBytes: await remainingImageBytes(source, 262144, 2097152) };
                    measurementState(campaign, 'acquiring');
                    const owned = await withMeasurementOwners(join(source, 'store.sqlite-shm'), measurementAccount, { [Symbol.iterator]: () => peers.values() }, async (retained) => { measurement = retained; measurementState(campaign, 'owned'); await scope.stage('fixture permissions', () => prepareModes(row.id, source)); scope.assert(); modesPrepared = true; interval.push('fixture.permission-layout'); await image('fixture-prepared'); await sequence(index); }, { ...rawMeasurementPort, open: async (path) => { const handle = await scope.stage('Q9 raw acquisition', () => rawMeasurementPort.open(path)); measurementState(campaign, 'owned'); return { ...handle, stat: () => scope.stage('Q9 descriptor stat', () => handle.stat()), read: (target, position) => scope.stage('Q9 positional read', () => handle.read(target, position)), close: async () => { await handle.close(); measurementState(campaign, 'closed'); } }; } });
                    const outcome = owned.measurement;
                    measurementClosure = outcome.closure;
                    measurementState(campaign, outcome.closure.resolved ? 'closed' : 'unresolved');
                    failures.push(...outcome.failures, ...owned.ownerFailures);
                    if (!outcome.callbackReturned || !outcome.completed || !outcome.closure.resolved) {
                        failures.push(new Error('Measurement scope incomplete; fixture provenance remains separate'));
                    }
                    return;
                }
                await scope.stage('fixture permissions', () => prepareModes(row.id, source));
                scope.assert();
                modesPrepared = true;
                if (['Q6', 'Q7', 'Q8', 'Q10'].includes(row.id)) {
                    interval.push('fixture.permission-layout');
                    await image('fixture-prepared');
                }
            }
            let peer = peers.get(role);
            if (!peer) {
                deadline();
                if (row.rolesInLaunchOrder[launched] !== role || ++campaign.launches > 47) {
                    throw new Error('Worker launch ledger changed');
                }
                launched++;
                peer = new Peer(role, join(source, 'store.sqlite'), proof, registry, count, { persist: (path, bytes) => budget.write(path, bytes, path.endsWith('stdout.jsonl') || path.endsWith('stderr.log') ? 'raw' : 'structured', true), onReceived: (receivedAction, reply) => observeReply(row.id, records, `${role}.${receivedAction}`, reply, row.orderedCommands, fixtureReady) });
                peers.set(role, peer);
            }
            campaign.requests++;
            if (campaign.requests > 414) {
                throw new Error('Protocol request quota exceeded');
            }
            const response = await scope.stage(stage, () => askStage(peer, stage, action, records));
            if (campaign.requests > 414 || count.value > row.maximumProtocolCommands) {
                throw new Error('Protocol request quota exceeded');
            }
            const reader = peers.get(row.id === 'C-false-release' ? 'C' : 'R');
            const slot = records.length;
            records.push({ stage, reply: response, ...(role === 'V' && action === 'readC' ? { readerAlive: reader?.running === true } : {}) });
            if (action === 'exit') {
                const exit = await peer.acknowledgeExit(response);
                const received = records[slot];
                if (received) {
                    records[slot] = { ...received, exit };
                }
            }
            scope.assert();
            interval.push(stage);
            if (action === 'close' || action === 'close-again' || action === 'exit') {
                if (record(response.cleanup) && response.cleanup.kind === 'failed') {
                    throw new Error('Native release reported failure');
                }
            }
            if (imageBarriers[row.id]?.includes(stage)) {
                await image(stage);
            }
            if ((stage === 'R.profile' || stage === 'R2.profile') && response.kind === 'ok') {
                if (stage === 'R.profile') {
                    caseBaseline = { proved: fixtureReady && profileObserved(response.profile), image: barriers.at(-1)?.image };
                }
                const priorOwners = [...peers].filter(([name]) => name !== role).map(([, owner]) => owner);
                const natural = records.filter(value => value.stage.endsWith('.exit')).every(value => value.exit?.code === 0 && value.exit.signal === null);
                establishedLayout = establishLayout(row.id, barriers.at(-1)?.image, response.profile, { writerLive: peers.get('W')?.running === true, allPriorOwnersExited: priorOwners.every(owner => !owner.running) && (writerExited || records.some(value => value.stage === 'W.exit')), closedNaturally: natural && !writerExited });
            }
            if (row.id === 'Q1' && stage === 'R.profile') {
                const baseline = barriers.at(-1)?.image;
                const main = file(baseline, 'store.sqlite');
                if (!main || main.length < 100 || main[18] !== 2 || main[19] !== 2 || file(baseline, 'store.sqlite-wal') || file(baseline, 'store.sqlite-shm')) {
                    fixtureReady = false;
                    throw new Error('Naturally closed WAL fixture unproved');
                }
            }
            if (action === 'commitB' && ['Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q16', 'Q17', 'Q18', 'C-false-release'].includes(row.id)) {
                const baseline = barriers.find(value => value.label === 'W.checkpoint')?.image;
                const latest = barriers.at(-1)?.image;
                const a = file(baseline, 'store.sqlite'), b = file(latest, 'store.sqlite'), wal = file(latest, 'store.sqlite-wal');
                if (!a || !b || !a.equals(b) || !wal || wal.length <= 32) {
                    fixtureReady = false;
                    throw new Error('Uncheckpointed committed WAL fixture unproved');
                }
            }
            const partial = evaluateCell(row.id, records, effects, false, row.orderedCommands, fixtureReady);
            if (partial.outcome === 'counterexample') {
                campaign.stopped = true;
                campaign.reason = 'Observed candidate counterexample';
                throw new Error(campaign.reason);
            }
        }
    }
    try {
        await sequence(0);
        if (launched !== row.launches || count.value !== row.maximumProtocolCommands) {
            throw new Error('Incomplete selected schedule');
        }
        if (peers.size > 0 && [...peers.values()].some(peer => peer.running)) {
            throw new Error('Live native owner after ordinary schedule');
        }
    }
    catch (error: unknown) {
        failures.push(error);
    }
    finally {
        failures.push(...await abortAll(peers.values()));
        for (const peer of peers.values()) {
            for (const failure of peer.failureFacts) {
                if (typeof failure !== 'object' || failure === null || !failures.includes(failure)) {
                    failures.push(failure);
                }
            }
        }
        const allExited = [...peers.values()].every(peer => !peer.running);
        const measurementResolved = measurementClosure === null || (record(measurementClosure) && measurementClosure.resolved === true);
        if (allExited && measurementResolved) {
            try {
                await restoreModes(source);
            }
            catch (error: unknown) {
                failures.push(error);
            }
        }
        else {
            campaign.expired = true;
            failures.push(new Error('Unresolved owner/measurement cleanup; fixture modes retained'));
        }
    }
    const cleanup = failures.length === 0 && [...peers.values()].every(peer => !peer.running);
    let conclusion = evaluateCell(row.id, records, effects, cleanup, row.orderedCommands, fixtureReady);
    if ((failures.length || physicalEffects.unknown.length) && conclusion.outcome !== 'counterexample') {
        conclusion = { ...conclusion, outcome: 'unproved', measurement: false };
    }
    return { id: row.id, conclusion, records, images: imageAttempts, effects, physicalEffects, failures: failures.map(errorFacts), measurementClosure, fixtureReady };
}
/** Root-gated caller supplies a previously frozen manifest; this function never rebuilds or installs. @internal */
export async function runQualification(manifest: IManifest, startedAt: number): Promise<unknown> {
    const output = manifest.output;
    const registry = new Set<Peer>();
    const campaign: ICampaign = { deadlineAt: startedAt + bounds.coordinatorMilliseconds, launches: 0, requests: 0, expired: false, measurement: 'not-started' };
    const cells: ICellProof[] = [];
    const failures: unknown[] = [];
    const started = startedAt;
    const clock = new ExecutionScope(startedAt, bounds.coordinatorMilliseconds, campaign, () => registry, failures, 'coordinator', bounds.stageMilliseconds, expired);
    const budget = new ProofBudget(clock);
    budget.reserve('structured', 65536);
    const cancel = (value: unknown): void => {
        if (record(value) && value.kind === 'cancel') {
            campaign.expired = true;
            campaign.reason = 'Outer cancellation';
            expired('Outer cancellation', clock.pendingStages);
            void abortAll(registry).then(errors => { failures.push(...errors); });
        }
    };
    process.on('message', cancel);
    measurementState(campaign, 'closed');
    let completionPins = false;
    const previousAddon = process.env.WAL302_ADDON_SHA;
    const binary = manifest.pins.find(value => value.path.endsWith('/build/Release/better_sqlite3.node'));
    if (!binary) {
        throw new Error('Frozen addon pin absent');
    }
    process.env.WAL302_ADDON_SHA = binary.sha256;
    try {
        await budget.write(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), 'pins');
        const ledger = validateLedger(JSON.parse(await readFile(join(manifest.root, 'experiments/exp-wal-coordinated-snapshot/command-ledger.json'), 'utf8')) as unknown);
        const rows = selectedLedger(ledger);
        await budget.write(join(output, 'predeclared-cells.json'), JSON.stringify(rows.map(row => ({ id: row.id, outcome: 'unexecuted' }))), 'structured');
        for (const row of rows) {
            clock.assert();
            if (campaign.expired || campaign.stopped) {
                throw new Error(campaign.reason ?? 'Coordinator stopped');
            }
            const cell = await runCell(row, output, registry, budget, campaign);
            cells.push(cell);
            await budget.write(join(output, 'proof', row.id, 'result.json'), JSON.stringify(cell, null, 2), 'structured');
            if (cell.conclusion.outcome === 'counterexample') {
                break;
            }
        }
    }
    catch (error: unknown) {
        failures.push(error);
    }
    finally {
        clock.dispose();
        failures.push(...await abortAll(registry));
        completionPins = await completeVerification(clock, () => verifyManifest(manifest, import.meta.url), failures);
        process.off('message', cancel);
        if (previousAddon === undefined) {
            delete process.env.WAL302_ADDON_SHA;
        }
        else {
            process.env.WAL302_ADDON_SHA = previousAddon;
        }
    }
    failures.push(...eventFailures);
    const conclusions = cells.map(value => completionPins ? value.conclusion : { ...value.conclusion, pins: false });
    const verdict = terminalVerdict(conclusions, campaign, failures);
    const report = { issue: 302, verdict, cells: conclusions, unexecuted: [...Array.from({ length: 18 }, (_, i) => `Q${i + 1}`), 'C-stale', 'C-torn', 'C-immediate', 'C-forbidden-effects', 'C-false-release'].filter(id => !cells.some(cell => cell.id === id)), failures: failures.map(errorFacts), counters: { ...campaign, proof: budget.used, elapsed: Date.now() - started }, transientNativeWriteAbsence: 'unproved', exactVfsName: 'unavailable through selected binding', nativeEndCloseMalfunction: 'unexercised', differentOwnerAndReadonlyMedia: 'unproved' };
    const reportBytes = JSON.stringify(report, null, 2);
    if (Buffer.byteLength(reportBytes) > 65536) {
        throw new Error('Reserved final receipt quota exceeded');
    }
    try {
        await writeFile(join(output, 'report.json'), reportBytes, { flag: 'wx' });
    }
    catch (error: unknown) {
        failures.push(error);
        return { ...report, verdict: verdict === 'REJECT' ? 'REJECT' : 'INCONCLUSIVE', failures: failures.map(errorFacts), harness: 'final report persistence failed' };
    }
    return report;
}
