/** Recorded qualification separates a proved fixture, each causal stage, native lifetime, and independent progress. */
import { pairMatches } from '../src/evidence.js';
import type { ICell, IPair } from '../src/evidence.js';
import { record } from './peer.js';
import type { IReply } from './peer.js';
/** A reply retains the request it actually answered, with actual-exit and living-reader witnesses. @internal */
export interface IStageRecord {
    readonly stage: string;
    readonly reply: IReply;
    readonly exit?: {
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
    };
    readonly readerAlive?: boolean;
}
/** Unknown row values are narrowed before literal comparison; absent rows never count as matching evidence. @internal */
export function pair(value: unknown): IPair | undefined { if (!record(value) || typeof value.revision !== 'number' || typeof value.currentRevision !== 'number' || typeof value.value !== 'string') {
    return undefined;
} return { revision: value.revision, currentRevision: value.currentRevision, value: value.value }; }
/** Checkpoint status retains all SQLite fields with their actual finite domain. @internal */
export function busy(reply: IReply | undefined): number | undefined { const rows = reply?.checkpoint; if (!Array.isArray(rows) || rows.length !== 1 || !record(rows[0])) {
    return undefined;
} const value = rows[0]; if (!Number.isSafeInteger(value.busy) || (value.busy !== 0 && value.busy !== 1) || typeof value.log !== 'number' || !Number.isSafeInteger(value.log) || typeof value.checkpointed !== 'number' || !Number.isSafeInteger(value.checkpointed) || value.log < 0 || value.checkpointed < 0 || value.checkpointed > value.log) {
    return undefined;
} return value.busy; }
/** Effective denial requires an actual syscall result; neither UID nor selected modes are a substitute. */
function denied(value: unknown): boolean { return record(value) && value.ok === false && record(value.error) && ['EACCES', 'EPERM', 'EROFS'].includes(String(value.error.code)); }
/** Every witness is either an actual successful open or an observed finite errno. */
function witness(value: unknown): boolean { return record(value) && (value.ok === true || value.ok === false && record(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string'); }
/** The host/profile evidence is required even for ordinary writable profiles. @internal */
export function profileObserved(value: unknown): boolean { if (!record(value) || typeof value.execPath !== 'string' || !value.execPath || typeof value.node !== 'string' || !value.node.startsWith('v24.') || typeof value.platform !== 'string' || typeof value.arch !== 'string' || (value.nativeByteOrder !== 'LE' && value.nativeByteOrder !== 'BE') || !Number.isSafeInteger(value.pid) || !Number.isSafeInteger(value.uid) || !Number.isSafeInteger(value.gid) || !Array.isArray(value.groups) || !value.groups.every((group: unknown) => Number.isSafeInteger(group)) || !Number.isSafeInteger(value.umask) || typeof value.entry !== 'string' || typeof value.entrySha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.entrySha256) || typeof value.bindingPackage !== 'string' || typeof value.packageSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.packageSha256) || !record(value.binding) || value.binding.version !== '12.9.0' || !record(value.filesystem) || !Number.isSafeInteger(value.filesystem.type) || !Number.isSafeInteger(value.filesystem.device) || !Array.isArray(value.files) || value.files.length !== 4 || !witness(value.create)) {
    return false;
} const files: unknown[] = value.files; return ['', '-wal', '-shm', '-journal'].every(suffix => { const file = files.find((item: unknown) => record(item) && item.suffix === suffix); if (!record(file) || !record(file.stat) || !witness(file.read) || !witness(file.readWrite)) {
    return false;
} const stat = file.stat; return record(stat.error) ? typeof stat.error.code === 'string' : stat.regular === true && ['mode', 'uid', 'gid', 'dev', 'ino', 'size'].every(key => Number.isSafeInteger(stat[key])); }); }
/** Profile compatibility is distinct from the profile receipt's integrity. @internal */
export function permissionsObserved(id: string, profile: unknown): boolean { if (!['Q6', 'Q7', 'Q8', 'Q9', 'Q10'].includes(id)) {
    return true;
} if (!record(profile) || !Array.isArray(profile.files)) {
    return false;
} const files: unknown[] = profile.files; const get = (suffix: string): Record<string, unknown> | undefined => { const value = files.find(item => record(item) && item.suffix === suffix); return record(value) ? value : undefined; }; const readable = (value: unknown): boolean => record(value) && value.ok === true; const main = get(''); if (!main || !readable(main.read) || !denied(main.readWrite)) {
    return false;
} if (id !== 'Q10') {
    const wal = get('-wal');
    if (!wal || !readable(wal.read) || !denied(wal.readWrite)) {
        return false;
    }
} if (id === 'Q9') {
    const shm = get('-shm');
    if (!shm || !denied(shm.read) || !denied(shm.readWrite)) {
        return false;
    }
} if (id === 'Q6') {
    const shm = get('-shm');
    if (!shm || !readable(shm.read) || !denied(shm.readWrite)) {
        return false;
    }
} return id === 'Q7' ? readable(profile.create) : denied(profile.create); }
/** Native refusal has a genuine SQLite class/code, not a transport or invented adapter exception. */
function nativeRefusal(reply: IReply): boolean { return reply.kind === 'failed' && record(reply.failure) && reply.failure.type === 'SqliteError' && typeof reply.failure.code === 'string' && reply.failure.code.startsWith('SQLITE_'); }
/** Cleanup envelopes never replace actual native flags or process exits. */
function cleanupObserved(reply: IReply): boolean { return record(reply.cleanup) && reply.cleanup.kind === 'closed' && Array.isArray(reply.cleanup.failures) && reply.cleanup.failures.length === 0; }
/** Ended-but-open and actually closed handles are different lifetime observations. */
function nativeState(reply: IReply, state: 'opened' | 'active' | 'ended' | 'closed', allowUnopened = false): boolean { const value = reply.facts; if (!record(value) || value.state !== state) {
    return false;
} if (allowUnopened && state === 'closed' && value.open === null && value.inTransaction === null && value.readonly === null) {
    return true;
} return value.open === (state !== 'closed') && value.inTransaction === (state === 'active') && value.readonly === true; }
/** Runtime information must come after an actual anchor and preserve the loaded SQLite source identity. */
function runtimeObserved(value: unknown): boolean { return record(value) && record(value.version) && typeof value.version.version === 'string' && value.version.version.length > 0 && typeof value.version.source_id === 'string' && value.version.source_id.length > 0 && Array.isArray(value.options) && value.options.length > 0 && value.options.every((option: unknown) => record(option) && typeof option.compile_options === 'string'); }
/** A failed fixture operation makes later candidate answers causally unproved, rather than a candidate counterexample. */
function checkpointObserved(action: string, reply: IReply): boolean { const status = busy(reply); if (action.includes('blocked')) {
    return status === 1;
} if (status !== 0 || !Array.isArray(reply.checkpoint) || !record(reply.checkpoint[0])) {
    return false;
} return reply.checkpoint[0].log === 0 && reply.checkpoint[0].checkpointed === 0; }
/** Reached-prefix proof is separate from complete cell coverage, cleanup and the eventual qualification outcome. @internal */
export interface ICellAssessment {
    readonly conclusion: ICell;
    readonly causalPrefixProved: boolean;
    /** Exact Q13 fixed-query refusal reached after a valid readonly prefix; it does not prove general success or normal exit. */
    readonly q13RefusalAttachmentIndex: number | null;
}
/** One ordered evaluator owns both causal-prefix validation and preservation of earlier established counterexamples. @internal */
export function assessCell(id: string, records: readonly IStageRecord[], effects: readonly string[], cleanup: boolean, expectedStages?: readonly string[], fixtureReady = false): ICellAssessment {
    const optional = ['Q6', 'Q8', 'Q9', 'Q10'].includes(id), invalid = ['Q11', 'Q12', 'Q13', 'Q14', 'Q15'].includes(id);
    let causal = fixtureReady, valid = true, counterexample = effects.length > 0, nativeFailed = false, refusal = false, unavailable = false;
    let q13RefusalAttachmentIndex: number | null = null;
    // Successful native lifetime steps are prerequisites independent of query success and reported cleanup.
    const anchored = new Set<string>(), opened = new Set<string>(), begun = new Set<string>(), ended = new Set<string>();
    const result = (outcome: ICell['outcome'], pins: boolean): ICellAssessment => ({ conclusion: { id, outcome, pins, cleanup, measurement: effects.length === 0, ...(outcome === 'unavailable' ? { limitation: 'Effective optional permission fixture unavailable' } : outcome === 'unsupported' ? { limitation: 'Native readonly compatibility refused under the observed optional profile' } : {}) }, causalPrefixProved: fixtureReady && valid && causal && pins && !counterexample && !nativeFailed && !unavailable, q13RefusalAttachmentIndex: fixtureReady && valid && causal && pins && !counterexample && !unavailable ? q13RefusalAttachmentIndex : null });
    if (!expectedStages) {
        valid = false;
    }
    const actualOpen = records.filter(value => /\.(?:open|open-delete|open-readonly|open-writable)$/u.test(value.stage));
    const pins = actualOpen.length > 0 && actualOpen.every(value => record(value.reply.addon) && typeof value.reply.addon.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(value.reply.addon.sha256));
    for (const [index, entry] of records.entries()) {
        const dot = entry.stage.indexOf('.'), role = entry.stage.slice(0, dot), action = entry.stage.slice(dot + 1), normalized = action.replace(/-if-(?:open|pair-success|success)$/u, '');
        const reply = entry.reply;
        if (expectedStages?.[index] !== entry.stage) {
            valid = false;
            causal = false;
        }
        const reader = role === 'R' || role === 'R2' || role === 'C' && id === 'C-false-release';
        let good = true;
        if (action === 'profile') {
            good = reply.kind === 'ok' && profileObserved(reply.profile);
            if (role === 'R' && good && !permissionsObserved(id, reply.profile)) {
                if (optional) {
                    unavailable = true;
                }
                else {
                    good = false;
                }
            }
        }
        else if (action === 'exit') {
            good = reply.kind === 'exiting' && cleanupObserved(reply) && entry.exit?.code === 0 && entry.exit.signal === null && (!reader || nativeState(reply, 'closed', !opened.has(role)));
        }
        else if (action === 'close' || action === 'close-again') {
            good = reply.kind === 'ok' && cleanupObserved(reply) && (!reader || nativeState(reply, 'closed', !opened.has(role)));
        }
        else if (role === 'W' || role === 'V') {
            if (action === 'commitB-blocked') {
                const failure = reply.failure;
                good = reply.kind === 'failed' && record(failure) && (failure.type === 'SqliteBusyError' || typeof failure.code === 'string' && failure.code.startsWith('SQLITE_BUSY') || record(failure.cause) && typeof failure.cause.code === 'string' && failure.cause.code.startsWith('SQLITE_BUSY'));
            }
            else {
                good = reply.kind === 'ok';
                if (action.startsWith('commit')) {
                    const value = pair(reply.pair);
                    good = good && value !== undefined && pairMatches(value, action.slice(6, 7));
                }
                if (action.startsWith('checkpoint')) {
                    good = good && checkpointObserved(action, reply) && typeof reply.elapsed === 'number' && Number.isFinite(reply.elapsed) && reply.elapsed >= 0 && reply.elapsed <= 5000;
                }
                if (action === 'holdUncommittedC') {
                    good = good && reply.uncommitted === true;
                }
                if (action === 'rollbackC') {
                    good = good && reply.uncommitted === false;
                }
                if (action === 'hot-seedA') {
                    good = good && record(reply.rows) && reply.rows.count === 64 && reply.rows.bytes === 4096 && record(reply.synchronous) && reply.synchronous.synchronous === 2;
                }
                if (action === 'readC') {
                    const value = pair(reply.pair);
                    good = good && value !== undefined && pairMatches(value, 'C') && entry.readerAlive === true;
                }
            }
        }
        else if (role === 'C' && id === 'C-torn') {
            good = reply.kind === 'ok';
            if (action === 'metaB') {
                good = good && record(reply.meta) && reply.meta.revision === 2;
            }
            if (action === 'currentC') {
                good = good && record(reply.current) && reply.current.revision === 3 && reply.current.value === 'C';
            }
        }
        else if (role === 'C' && id === 'C-immediate') {
            good = reply.kind === 'ok';
        }
        else if (action === 'nested-begin-refused') {
            good = reply.kind === 'refused' && nativeState(reply, 'active');
        }
        else if (action === 'read-after-end-refused') {
            good = reply.kind === 'refused' && nativeState(reply, 'ended');
        }
        else if (action === 'read-after-close') {
            good = reply.kind === 'refused' && nativeState(reply, 'closed', !opened.has(role));
        }
        else if (action === 'native-overflow-and-cleanup' || action === 'fixed-caller-failure-and-cleanup') {
            const failure = reply.failure;
            good = reply.kind === 'failed' && cleanupObserved(reply) && nativeState(reply, 'closed') && record(failure) && anchored.has(role);
            if (action.startsWith('native')) {
                good = good && record(failure) && failure.type === 'SqliteError' && failure.code === 'SQLITE_ERROR' && typeof failure.message === 'string' && failure.message.includes('integer overflow') && record(reply.overflowDiagnostic) && reply.overflowDiagnostic.form === 'integer' && reply.overflowDiagnostic.reader === true;
            }
            else {
                good = good && record(failure) && failure.type === 'Error' && failure.message === 'fixed-caller-failure';
            }
        }
        else if (action === 'fake-end') {
            good = reply.kind === 'ok' && reply.claimedEnded === true && nativeState(reply, 'active');
        }
        else if (action.startsWith('status')) {
            good = reply.kind === 'ok' && nativeState(reply, action === 'status-ended' ? 'ended' : action === 'status-active' ? 'active' : nativeFailed || action === 'status-closed' ? 'closed' : ended.has(role) ? 'ended' : 'active', !opened.has(role));
        }
        else if (action.includes('-if-') && reply.kind === 'skipped') {
            good = nativeFailed && nativeState(reply, 'closed', !opened.has(role));
        }
        else if (nativeRefusal(reply) && (normalized === 'open' || normalized === 'begin' || normalized.startsWith('anchor') || normalized.startsWith('read'))) {
            const failedBefore = nativeFailed;
            nativeFailed = true;
            refusal = true;
            good = cleanupObserved(reply) && nativeState(reply, 'closed', !opened.has(role));
            if (causal && !invalid && !optional) {
                counterexample = true;
            }
            if (invalid && id === 'Q15') {
                good = good && record(reply.failure) && reply.failure.code === 'SQLITE_READONLY_ROLLBACK';
            }
            // The fixed foreign-table query can coordinate before failing; this proves only that exact opportunity.
            if (id === 'Q13' && role === 'R' && action === 'anchor-if-open' && !failedBefore && good && causal && valid && pins && opened.has(role) && begun.has(role) && record(reply.failure) && reply.failure.code === 'SQLITE_ERROR' && reply.failure.message === 'no such table: snapshot_meta') {
                q13RefusalAttachmentIndex = index;
            }
        }
        else if (nativeFailed && (normalized === 'open' || normalized === 'begin' || normalized.startsWith('anchor') || normalized.startsWith('read') || normalized === 'runtime' || normalized === 'end')) {
            good = false;
        }
        else {
            good = reply.kind === 'ok';
            if (normalized === 'open') {
                good = good && nativeState(reply, 'opened');
                if (good) {
                    opened.add(role);
                }
            }
            else if (normalized === 'begin') {
                good = good && nativeState(reply, 'active');
                if (good) { begun.add(role); }
            }
            else if (normalized.startsWith('anchor') || normalized.startsWith('read')) {
                const value = pair(reply.pair), expected = role === 'R2' || id === 'Q3' ? 'C' : id === 'C-stale' ? 'A' : 'B';
                good = good && value !== undefined && nativeState(reply, 'active');
                if (good && value) {
                    if (causal && (invalid || !pairMatches(value, expected))) {
                        counterexample = true;
                    }
                    if (!invalid && pairMatches(value, expected) && normalized.startsWith('anchor')) {
                        anchored.add(role);
                    }
                }
            }
            else if (normalized === 'runtime') {
                good = good && anchored.has(role) && nativeState(reply, 'active') && runtimeObserved(reply.runtime);
            }
            else if (normalized === 'end' || action === 'real-end') {
                good = good && nativeState(reply, 'ended');
                if (good) {
                    ended.add(role);
                }
            }
            else {
                good = false;
            }
        }
        if (!good) {
            valid = false;
            causal = false;
        }
    }
    if (counterexample) {
        return result('counterexample', pins);
    }
    if (!fixtureReady || !valid || !expectedStages || records.length !== expectedStages.length || !cleanup || !pins) {
        return result('unproved', pins);
    }
    if (unavailable) {
        return result('unavailable', true);
    }
    if (invalid) {
        return result(refusal ? 'observed' : 'unproved', pins);
    }
    if (optional && refusal) {
        return result('unsupported', pins);
    }
    if (id !== 'C-torn' && id !== 'C-immediate' && !anchored.has(id === 'C-false-release' ? 'C' : 'R')) {
        return result('unproved', pins);
    }
    return result('observed', pins);
}

/** Cell conclusions retain their existing contract; a proved partial prefix never substitutes for full coverage or cleanup. @internal */
export function evaluateCell(id: string, records: readonly IStageRecord[], effects: readonly string[], cleanup: boolean, expectedStages?: readonly string[], fixtureReady = false): ICell {
    return assessCell(id, records, effects, cleanup, expectedStages, fixtureReady).conclusion;
}
