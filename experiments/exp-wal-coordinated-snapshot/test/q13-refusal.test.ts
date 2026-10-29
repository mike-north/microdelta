/** Exact retained Q13 bytes test expected-refusal causality without new native execution or invented successful replies. */
import { expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { effectIntervalContext } from '../node/effect-interval.js';
import { classifyEffects } from '../node/effects-policy.js';
import type { IEstablishedLayout, IEffectsClassification } from '../node/effects-policy.js';
import { establishLayout } from '../node/layout.js';
import type { ISourceImage } from '../node/images.js';
import { assessCell, evaluateCell } from '../node/oracle.js';
import type { IStageRecord } from '../node/oracle.js';
import { record } from '../node/peer.js';
import type { IReply } from '../node/peer.js';
import { validateLedger } from '../node/schedule.js';

/** Captured native files remain inert source artifacts, never SQLite inputs or regenerated fixtures. */
const fixture = new URL('../../../../experiments/exp-wal-coordinated-snapshot/test/fixtures/q13-replay-refusal/', import.meta.url);
/** Buffer hashes bind copied files to the preserved native metadata. */
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
/** Each consumer narrows the specific retained JSON fields it needs. */
async function json(name: string): Promise<unknown> { return JSON.parse(await readFile(new URL(name, fixture), 'utf8')) as unknown; }
/** Actual stage and exit facts are independent of the saved case verdict. */
function stages(value: unknown): IStageRecord[] {
    if (!record(value) || !Array.isArray(value.records)) { throw new Error('Missing Q13 records'); }
    return value.records.map((entry: unknown) => {
        if (!record(entry) || typeof entry.stage !== 'string' || !record(entry.reply) || typeof entry.reply.id !== 'number' || typeof entry.reply.kind !== 'string') { throw new Error('Malformed Q13 record'); }
        let exit: IStageRecord['exit'];
        if (entry.exit !== undefined) {
            if (!record(entry.exit) || typeof entry.exit.code !== 'number' || entry.exit.signal !== null) { throw new Error('Unexpected retained exit'); }
            exit = { code: entry.exit.code, signal: null };
        }
        return { stage: entry.stage, reply: { ...entry.reply, id: entry.reply.id, kind: entry.reply.kind }, ...(exit ? { exit } : {}) };
    });
}
/** Complete sampled buffers retain original identities rather than copied fixture inode numbers. */
async function image(number: 1 | 3 | 4): Promise<ISourceImage> {
    const metadata = await json(`image-${number}.json`);
    if (!record(metadata) || metadata.complete !== true || !Array.isArray(metadata.files)) { throw new Error('Incomplete Q13 metadata'); }
    const files = await Promise.all(metadata.files.map(async (file: unknown) => {
        if (!record(file) || typeof file.name !== 'string' || !['store.sqlite', 'store.sqlite-wal', 'store.sqlite-shm'].includes(file.name) || typeof file.dev !== 'number' || typeof file.ino !== 'number' || typeof file.size !== 'number' || typeof file.sha256 !== 'string') { throw new Error('Malformed Q13 file'); }
        const bytes = await readFile(new URL(`image-${number}-${file.name}`, fixture));
        if (bytes.length !== file.size || digest(bytes) !== file.sha256) { throw new Error('Changed Q13 fixture bytes'); }
        return { name: file.name, bytes, dev: file.dev, ino: file.ino, sha256: file.sha256 };
    }));
    return { files, totalBytes: files.reduce((sum, file) => sum + file.bytes.length, 0) };
}
const records = stages(await json('result.json'));
const profileImage = await image(1), before = await image(3), after = await image(4);
const ledger = validateLedger(JSON.parse(await readFile(new URL('../../../../experiments/exp-wal-coordinated-snapshot/command-ledger.json', import.meta.url), 'utf8')) as unknown);
const row = ledger.rows.find(item => item.id === 'Q13');
if (!row) { throw new Error('Missing Q13 schedule'); }
const expectedStages = row.orderedCommands;
const cut = records.findIndex(entry => entry.stage === 'R.anchor-if-open');
if (cut < 0) { throw new Error('Missing actual fixed refusal'); }
/** Actual prior exit and matching profile/header establish the selected closed foreign WAL layout. */
function layoutFor(selected: readonly IStageRecord[]): IEstablishedLayout {
    const profile = selected.find(entry => entry.stage === 'R.profile')?.reply.profile;
    const exited = selected.some(entry => entry.stage === 'W.exit' && entry.exit?.code === 0 && entry.exit.signal === null);
    return establishLayout('Q13', profileImage, profile, { writerLive: false, allPriorOwnersExited: exited, closedNaturally: exited });
}
const layout = layoutFor(records);
/** This is the same actual caller context and byte classifier, preserving the one-record image interval. */
function context(overrides: {
    readonly records?: readonly IStageRecord[];
    readonly caseId?: string;
    readonly captureLabel?: string;
    readonly stages?: readonly string[];
    readonly beforeRecordCount?: number;
    readonly fixtureReady?: boolean;
    readonly layout?: IEstablishedLayout;
    readonly expectedStages?: readonly string[];
} = {}) {
    return effectIntervalContext({ caseId: 'Q13', captureLabel: 'R.anchor-if-open', stages: ['R.anchor-if-open'], beforeRecordCount: cut, records, expectedStages, fixtureReady: true, layout, ...overrides });
}
/** Counterfactual record mutations never alter retained files or make the refused query successful. */
function changed(stage: string, transform: (reply: IReply) => IReply): IStageRecord[] { return records.map(entry => entry.stage === stage ? { ...entry, reply: transform(entry.reply) } : entry); }
/** Exact bytes need causal authority as well as recognizable format. */
function unknown(result: IEffectsClassification): void { expect(result.allowed).toEqual([]); expect(result.unknown.length).toBeGreaterThan(0); }
/** Byte controls clone measured buffers only; no native fixture is generated. */
function alteredImage(value: ISourceImage, name: string, transform: (bytes: Buffer) => Buffer): ISourceImage {
    const files = value.files.map(file => {
        if (file.name !== name) { return file; }
        const bytes = transform(Buffer.from(file.bytes));
        return { ...file, bytes, sha256: digest(bytes) };
    });
    return { files, totalBytes: files.reduce((sum, file) => sum + file.bytes.length, 0) };
}

test('retained provenance binds all raw files and preserves original incomplete cleanup', async () => {
    const provenance = await json('provenance.json');
    if (!record(provenance) || !Array.isArray(provenance.files)) { throw new Error('Missing Q13 provenance'); }
    expect(provenance.replayPacketSha256).toBe('1f3a0b1725886f039283c5128747449c5725a186ed4dc76f851a2894f3bef3c8');
    expect(provenance.originalVerdict).toBe('INCONCLUSIVE');
    expect(provenance.originalQ13Cleanup).toBe(false);
    for (const file of provenance.files) {
        if (!record(file) || typeof file.name !== 'string' || typeof file.bytes !== 'number' || typeof file.sha256 !== 'string') { throw new Error('Malformed provenance'); }
        const bytes = await readFile(new URL(file.name, fixture));
        expect(bytes.length).toBe(file.bytes); expect(digest(bytes)).toBe(file.sha256);
    }
});

test('only the actual expected Q13 fixed-query refusal proves current-interval coordination opportunity', () => {
    expect(layout).toMatchObject({ kind: 'healthy-wal', ownership: 'closed-clean', databasePages: 2 });
    expect(records[cut]?.reply).toMatchObject({ kind: 'failed', failure: { type: 'SqliteError', code: 'SQLITE_ERROR', message: 'no such table: snapshot_meta' } });
    const assessment = assessCell('Q13', records, [], false, expectedStages, true);
    expect(assessment.causalPrefixProved).toBe(false);
    expect(context()).toMatchObject({ readerOnly: true, stage: 'anchor', firstAttachment: true });
    const result = classifyEffects('Q13', layout, context(), before, after);
    expect(result.unknown).toEqual([]); expect(result.forbidden).toEqual([]);
    expect(result.allowed.map(effect => effect.file).sort()).toEqual(['store.sqlite-shm', 'store.sqlite-wal']);
    expect(evaluateCell('Q13', records, [], true, expectedStages, true).outcome).toBe('unproved');
    expect(evaluateCell('Q13', records, [], false, expectedStages, true).cleanup).toBe(false);
});

for (const failure of [
    { type: 'Error', code: 'SQLITE_ERROR', message: 'no such table: snapshot_meta' },
    { type: 'SqliteError', code: 'SQLITE_BUSY', message: 'no such table: snapshot_meta' },
    { type: 'SqliteError', code: 'SQLITE_ERROR', message: 'no such table: other' },
    { type: 'SqliteError', code: 'SQLITE_ERROR', message: 'not authorized' },
]) {
    test(`wrong or non-native refusal ${failure.type}/${failure.code}/${failure.message} grants no attachment`, () => {
        const selected = context({ records: changed('R.anchor-if-open', reply => ({ ...reply, failure })) });
        expect(selected.firstAttachment).toBe(false); unknown(classifyEffects('Q13', layout, selected, before, after));
    });
}
for (const predecessor of ['W.foreign-seed', 'W.close', 'R.open', 'R.begin-if-open']) {
    test(`failed ${predecessor} is never repaired by the later expected refusal`, () => {
        const selected = context({ records: changed(predecessor, reply => ({ ...reply, kind: 'failed' })) });
        expect(selected.firstAttachment).toBe(false); unknown(classifyEffects('Q13', layout, selected, before, after));
    });
}
for (const stage of ['R.open', 'R.begin-if-open']) {
    test(`${stage} must actually observe native readonly authority`, () => {
        const selected = context({ records: changed(stage, reply => ({ ...reply, facts: { state: stage === 'R.open' ? 'opened' : 'active', open: true, inTransaction: stage !== 'R.open', readonly: false } })) });
        expect(selected.firstAttachment).toBe(false);
    });
}
for (const patch of [
    { facts: { state: 'active', open: true, inTransaction: true, readonly: true } },
    { facts: { state: 'closed', open: false, inTransaction: false, readonly: false } },
    { cleanup: { kind: 'failed', failures: ['close failure'] } },
    { cleanup: { kind: 'closed', failures: ['secondary failure'] } },
]) {
    test(`expected refusal still requires observed native closure ${JSON.stringify(patch)}`, () => {
        const selected = context({ records: changed('R.anchor-if-open', reply => ({ ...reply, ...patch })) });
        expect(selected.firstAttachment).toBe(false);
    });
}

test('missing owner exit, unproved fixture/layout and live or retained owner claims grant no selected Q13 exception', () => {
    const missing = records.map(entry => {
        if (entry.stage !== 'W.exit') { return entry; }
        const { exit: _exit, ...rest } = entry; return rest;
    });
    const variants = [context({ records: missing }), context({ fixtureReady: false }), context({ layout: { kind: 'unproved' } })];
    if (layout.kind !== 'healthy-wal') { throw new Error('Expected retained healthy fixture'); }
    variants.push(context({ layout: { ...layout, ownership: 'live-owner' } }), context({ layout: { ...layout, ownership: 'retained' } }));
    for (const selected of variants) { expect(selected.firstAttachment).toBe(false); }
});

test('missing addon pin or mismatched profile identity cannot be supplied by recognizable bytes', () => {
    const noAddon = changed('R.open', reply => ({ ...reply, addon: null }));
    expect(context({ records: noAddon }).firstAttachment).toBe(false);
    const identity = changed('R.profile', reply => {
        if (!record(reply.profile) || !Array.isArray(reply.profile.files)) { throw new Error('Missing actual profile'); }
        const files: unknown[] = reply.profile.files;
        return { ...reply, profile: { ...reply.profile, files: files.map(file => record(file) && file.suffix === '' && record(file.stat) ? { ...file, stat: { ...file.stat, ino: -1 } } : file) } };
    });
    expect(context({ records: identity, layout: layoutFor(identity) }).firstAttachment).toBe(false);
});

test('another case, wrong anchor stage, wrong cut or an earlier out-of-interval refusal grants no exception', () => {
    const wrongStage = records.map(entry => entry.stage === 'R.anchor-if-open' ? { ...entry, stage: 'R.read-if-open' } : entry);
    const variants = [
        context({ caseId: 'Q12' }),
        context({ records: wrongStage, captureLabel: 'R.read-if-open', stages: ['R.read-if-open'], expectedStages: expectedStages.map(stage => stage === 'R.anchor-if-open' ? 'R.read-if-open' : stage) }),
        context({ beforeRecordCount: cut - 1 }),
        context({ beforeRecordCount: records.length }),
        context({ stages: ['R.begin-if-open'] }),
    ];
    for (const selected of variants) { expect(selected.firstAttachment).toBe(false); }
});

for (const mode of ['malformed-main', 'malformed-shm', 'partial-shm', 'nonempty-wal']) {
    test(`${mode} remains outside the unchanged byte allowance`, () => {
        let old = before, fresh = after;
        if (mode === 'malformed-main') { old = alteredImage(before, 'store.sqlite', bytes => { bytes[0] = 0; return bytes; }); }
        if (mode === 'malformed-shm') { fresh = alteredImage(after, 'store.sqlite-shm', bytes => { bytes[136] = 1; return bytes; }); }
        if (mode === 'partial-shm') { fresh = alteredImage(after, 'store.sqlite-shm', bytes => bytes.subarray(0, bytes.length - 1)); }
        if (mode === 'nonempty-wal') { fresh = alteredImage(after, 'store.sqlite-wal', () => Buffer.from([1])); }
        const result = classifyEffects('Q13', layout, context(), old, fresh);
        expect(result.unknown.length + result.forbidden.length).toBeGreaterThan(0);
        if (mode === 'nonempty-wal') { expect(result.forbidden.some(effect => effect.file === 'store.sqlite-wal')).toBe(true); }
    });
}

test('actual main mutation or replacement remains forbidden independently of recognized coordination', () => {
    const mutation = alteredImage(after, 'store.sqlite', bytes => { bytes[100] = (bytes[100] ?? 0) ^ 1; return bytes; });
    const files = after.files.map(file => file.name === 'store.sqlite' ? { ...file, ino: file.ino + 1 } : file);
    const replacement = { files, totalBytes: after.totalBytes };
    for (const fresh of [mutation, replacement]) { expect(classifyEffects('Q13', layout, context(), before, fresh).forbidden.some(effect => effect.file === 'store.sqlite')).toBe(true); }
});

test('existing SHM replacement remains forbidden even when its final bytes have the known empty-index shape', () => {
    const shm = after.files.find(file => file.name === 'store.sqlite-shm');
    if (!shm) { throw new Error('Missing retained SHM'); }
    const files = [...before.files, { ...shm, ino: shm.ino - 1 }];
    const prior = { files, totalBytes: files.reduce((sum, file) => sum + file.bytes.length, 0) };
    expect(classifyEffects('Q13', layout, context(), prior, after).forbidden.some(effect => effect.file === 'store.sqlite-shm')).toBe(true);
});
