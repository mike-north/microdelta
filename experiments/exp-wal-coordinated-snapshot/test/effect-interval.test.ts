/** Retained native bytes challenge actual caller context without replaying SQLite or relabeling a composite barrier. */
import { expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { effectIntervalContext } from '../node/effect-interval.js';
import { classifyEffects } from '../node/effects-policy.js';
import type { IEstablishedLayout, IEffectStageContext, IEffectsClassification } from '../node/effects-policy.js';
import { establishLayout } from '../node/layout.js';
import type { ISourceImage } from '../node/images.js';
import type { IStageRecord } from '../node/oracle.js';
import { record } from '../node/peer.js';
import { validateLedger } from '../node/schedule.js';

/** Binary fixtures remain source artifacts: tsc emits tests, never regenerates or opens a SQLite image. */
const fixtureRoot = new URL('../../../../experiments/exp-wal-coordinated-snapshot/test/fixtures/q2-author-interval/', import.meta.url);
/** Hashes identify exact sampled buffers; copied fixture filesystem identities are not native-source identities. */
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
/** Unknown JSON stays unknown until each test-owned boundary narrows the fields it consumes. */
async function json(name: string): Promise<unknown> { return JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8')) as unknown; }
/** The case's finite receipt list preserves actual stage and actual exit facts independently of result assertions. */
function stageRecords(value: unknown): IStageRecord[] {
    if (!record(value) || !Array.isArray(value.records)) { throw new Error('Missing recorded Q2 stages'); }
    return value.records.map((entry: unknown) => {
        if (!record(entry) || typeof entry.stage !== 'string' || !record(entry.reply) || typeof entry.reply.id !== 'number' || typeof entry.reply.kind !== 'string') { throw new Error('Malformed recorded stage'); }
        let exit: IStageRecord['exit'];
        if (entry.exit !== undefined) {
            if (!record(entry.exit) || typeof entry.exit.code !== 'number' || entry.exit.signal !== null) { throw new Error('Fixture lacks actual successful exit shape'); }
            exit = { code: entry.exit.code, signal: null };
        }
        return { stage: entry.stage, reply: { ...entry.reply, id: entry.reply.id, kind: entry.reply.kind }, ...(exit ? { exit } : {}), ...(typeof entry.readerAlive === 'boolean' ? { readerAlive: entry.readerAlive } : {}) };
    });
}
/** Complete original metadata binds every byte, filename and source identity of the adjacent source image. */
async function image(number: 10 | 11): Promise<ISourceImage> {
    const metadata = await json(`image-${number}.json`);
    if (!record(metadata) || metadata.complete !== true || !Array.isArray(metadata.files)) { throw new Error('Incomplete retained image metadata'); }
    const files = await Promise.all(metadata.files.map(async (entry: unknown) => {
        if (!record(entry) || typeof entry.name !== 'string' || !['store.sqlite', 'store.sqlite-wal', 'store.sqlite-shm'].includes(entry.name) || typeof entry.dev !== 'number' || typeof entry.ino !== 'number' || typeof entry.size !== 'number' || typeof entry.sha256 !== 'string') { throw new Error('Malformed retained file metadata'); }
        const bytes = await readFile(new URL(`image-${number}-${entry.name}`, fixtureRoot));
        if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) { throw new Error('Retained bytes differ from original metadata'); }
        return { name: entry.name, bytes, dev: entry.dev, ino: entry.ino, sha256: entry.sha256 };
    }));
    return { files, totalBytes: files.reduce((sum, file) => sum + file.bytes.length, 0) };
}
/** Counterfactual byte controls clone only buffers; they never change the original fixture or native evidence. */
function changedImage(value: ISourceImage, name: string, transform: (bytes: Buffer) => Buffer): ISourceImage {
    const files = value.files.map(file => {
        if (file.name !== name) { return file; }
        const bytes = transform(Buffer.from(file.bytes));
        return { ...file, bytes, sha256: digest(bytes) };
    });
    return { files, totalBytes: files.reduce((sum, file) => sum + file.bytes.length, 0) };
}
const recorded = stageRecords(await json('result.json'));
const before = await image(10), after = await image(11);
const endingMetadata = await json('image-11.json');
if (!record(endingMetadata) || typeof endingMetadata.label !== 'string' || !Array.isArray(endingMetadata.stages) || !endingMetadata.stages.every((stage: unknown) => typeof stage === 'string')) { throw new Error('Missing actual composite interval metadata'); }
const captureLabel = endingMetadata.label;
const stages: readonly string[] = endingMetadata.stages;
const beforeRecordCount = recorded.findIndex(entry => entry.stage === 'R.exit') + 1;
if (beforeRecordCount <= 0) { throw new Error('Missing adjacent baseline record cut'); }
const ledger = validateLedger(JSON.parse(await readFile(new URL('../../../../experiments/exp-wal-coordinated-snapshot/command-ledger.json', import.meta.url), 'utf8')) as unknown);
const row = ledger.rows.find(value => value.id === 'Q2');
if (!row) { throw new Error('Missing Q2 schedule'); }
const expectedStages = row.orderedCommands;
const profile = recorded.find(entry => entry.stage === 'R2.profile')?.reply.profile;
/** The retained profile/layout is admitted only after both actual prior owner exits in the recorded prefix. */
const owners = { writerLive: false, allPriorOwnersExited: ['W.exit', 'R.exit'].every(stage => recorded.some(entry => entry.stage === stage && entry.exit?.code === 0 && entry.exit.signal === null)), closedNaturally: true };
const layout = establishLayout('Q2', before, profile, owners);
/** The production helper receives actual boundaries and records, separately from the ending capture label. */
function context(overrides: {
    readonly records?: readonly IStageRecord[];
    readonly captureLabel?: string;
    readonly stages?: readonly string[];
    readonly beforeRecordCount?: number;
    readonly fixtureReady?: boolean;
    readonly layout?: IEstablishedLayout;
} = {}): IEffectStageContext {
    return effectIntervalContext({ caseId: 'Q2', captureLabel, stages, beforeRecordCount, records: recorded, expectedStages, fixtureReady: true, layout, ...overrides });
}
/** Context-only negatives reuse the same exact bytes to prove that recognizable format grants no interval authority. */
function disposition(selected: IEffectStageContext, old = before, fresh = after, selectedLayout = layout): IEffectsClassification { return classifyEffects('Q2', selectedLayout, selected, old, fresh); }
/** Unknown remains explicit rather than gaining a known coordination allowance from unrelated or incomplete proof. */
function expectUnknown(result: IEffectsClassification): void {
    expect(result.allowed).toEqual([]);
    expect(result.unknown.some(effect => effect.file === 'store.sqlite-shm')).toBe(true);
}

test('fixture provenance binds exact native images and leaves the original native verdict unchanged', async () => {
    const provenance = await json('provenance.json');
    if (!record(provenance) || !Array.isArray(provenance.files)) { throw new Error('Missing fixture provenance'); }
    expect(provenance.authorPacketSha256).toBe('61ae397d76f9fbb621a75e2fde7271a60713977e86d64f9c7d02655e15bc92f2');
    expect(provenance.originalVerdict).toBe('INCONCLUSIVE');
    for (const entry of provenance.files) {
        if (!record(entry) || typeof entry.name !== 'string' || typeof entry.bytes !== 'number' || typeof entry.sha256 !== 'string') { throw new Error('Malformed fixture provenance'); }
        const bytes = await readFile(new URL(entry.name, fixtureRoot));
        expect(bytes.length).toBe(entry.bytes);
        expect(digest(bytes)).toBe(entry.sha256);
    }
    expect(before.files.find(file => file.name === 'store.sqlite-shm')?.sha256).toBe('91bf3341fc1cb5d5297c348bcd50983951c1e26594e2c07ed9affacbef97d6ae');
    expect(after.files.find(file => file.name === 'store.sqlite-shm')?.sha256).toBe('41e2982cd728bcc6356975b6c0ff80754bb1158c69b72aedd9652d1ad8c132a4');
});

test('actual composite attachment interval retains R2.exit while recognizing only the selected exact reconstruction', () => {
    const selected = context();
    expect(captureLabel).toBe('R2.exit');
    expect(stages).toEqual(['R2.profile', 'R2.open', 'R2.begin', 'R2.anchorC', 'R2.runtime', 'R2.end', 'R2.close', 'R2.exit']);
    expect(selected).toMatchObject({ readerOnly: true, stage: 'exit', firstAttachment: true });
    expect(layout).toMatchObject({ kind: 'healthy-wal', ownership: 'retained' });
    const result = disposition(selected);
    expect(result.forbidden).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.allowed).toHaveLength(1);
    expect(result.allowed[0]).toMatchObject({ file: 'store.sqlite-shm', reason: 'known finite committed retained-WAL index reconstruction with validated salts/checksums/page map' });
});

for (const ending of ['R.readB', 'R2.exit']) {
    test(`an isolated later ${ending} interval has no attachment authority`, () => {
        const index = recorded.findIndex(entry => entry.stage === ending);
        if (index < 0) { throw new Error('Missing actual isolated stage'); }
        const selected = context({ captureLabel: ending, stages: [ending], beforeRecordCount: index, records: recorded.slice(0, index + 1) });
        expect(selected.firstAttachment).toBe(false);
        expectUnknown(disposition(selected));
    });
}

test('the supplied interval stages must exactly match the adjacent recorded boundary cut', () => {
    for (const selected of [context({ stages: stages.filter(stage => stage !== 'R2.open') }), context({ beforeRecordCount: beforeRecordCount + 1 })]) {
        expect(selected.firstAttachment).toBe(false);
        expectUnknown(disposition(selected));
    }
});

test('attachment from before the before-image cannot authorize a later runtime/end/close/exit interval', () => {
    const cut = recorded.findIndex(entry => entry.stage === 'R2.runtime');
    const selected = context({ beforeRecordCount: cut, stages: recorded.slice(cut).map(entry => entry.stage) });
    expect(selected.stage).toBe('exit');
    expect(selected.firstAttachment).toBe(false);
    expectUnknown(disposition(selected));
});

for (const stage of ['W.checkpoint', 'R2.open', 'R2.begin', 'R2.anchorC']) {
    test(`failed ${stage} prefix cannot grant attachment authority to matching bytes`, () => {
        const broken = recorded.map(entry => entry.stage === stage ? { ...entry, reply: { ...entry.reply, kind: 'failed' } } : entry);
        const selected = context({ records: broken });
        expect(selected.firstAttachment).toBe(false);
        expectUnknown(disposition(selected));
    });
}

test('unproved fixture or layout cannot grant attachment authority', () => {
    const unproved: IEstablishedLayout = { kind: 'unproved' };
    for (const value of [{ selected: context({ fixtureReady: false }), selectedLayout: layout }, { selected: context({ layout: unproved }), selectedLayout: unproved }]) {
        expect(value.selected.firstAttachment).toBe(false);
        expectUnknown(disposition(value.selected, before, after, value.selectedLayout));
    }
});

test('live prior-owner layout remains excluded even with a successful recorded reader prefix', () => {
    const live = establishLayout('Q2', before, profile, { ...owners, writerLive: true });
    const selected = context({ layout: live });
    expect(selected.firstAttachment).toBe(false);
    expectUnknown(disposition(selected, before, after, live));
});

for (const stage of ['W.exit', 'R.exit']) {
    test(`missing actual ${stage} receipt cannot be replaced by a retained-layout claim`, () => {
        const broken = recorded.map(entry => {
            if (entry.stage !== stage) { return entry; }
            return { stage: entry.stage, reply: entry.reply, ...(entry.readerAlive !== undefined ? { readerAlive: entry.readerAlive } : {}) };
        });
        const selected = context({ records: broken });
        expect(selected.firstAttachment).toBe(false);
        expectUnknown(disposition(selected));
    });
}

for (const change of ['altered-wal', 'partial-wal', 'altered-index', 'partial-index']) {
    test(`${change} cannot inherit the valid interval's reconstruction allowance`, () => {
        let old = before, fresh = after;
        if (change === 'altered-wal' || change === 'partial-wal') {
            const alter = (bytes: Buffer): Buffer => { if (change === 'partial-wal') { return bytes.subarray(0, bytes.length - 1); } bytes[56] = (bytes[56] ?? 0) ^ 1; return bytes; };
            old = changedImage(before, 'store.sqlite-wal', alter);
            fresh = changedImage(after, 'store.sqlite-wal', alter);
        } else {
            fresh = changedImage(after, 'store.sqlite-shm', bytes => { if (change === 'partial-index') { return bytes.subarray(0, bytes.length - 1); } bytes[136] = (bytes[136] ?? 0) ^ 1; return bytes; });
        }
        expectUnknown(disposition(context(), old, fresh));
    });
}
