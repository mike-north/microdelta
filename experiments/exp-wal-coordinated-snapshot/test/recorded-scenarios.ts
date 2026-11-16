/** Complete synthetic receipts exercise the selected stage contracts; these are never native qualification evidence. */
import type { ILedgerRow } from '../node/schedule.js';
import type { IStageRecord } from '../node/oracle.js';
/** The synthetic host receipt includes every required observed profile dimension, independently of mode-bit assumptions. */
export function profile(id: string): unknown { const denied = { ok: false, error: { code: 'EACCES', message: 'fixture denial', type: 'Error' } }; return { execPath: '/pinned/node', node: 'v24.14.0', platform: 'darwin', arch: 'arm64', nativeByteOrder: 'LE', pid: 42, uid: 501, gid: 20, groups: [20], umask: 0o22, entry: '/pinned/worker.js', entrySha256: 'a'.repeat(64), bindingPackage: '/pinned/package.json', packageSha256: 'b'.repeat(64), binding: { version: '12.9.0' }, filesystem: { type: 123, device: 1 }, files: ['', '-wal', '-shm', '-journal'].map(suffix => ({ suffix, stat: { mode: 0o100600, uid: 501, gid: 20, dev: 1, ino: 5, size: 64, regular: true }, read: id === 'Q9' && suffix === '-shm' ? denied : { ok: true }, readWrite: ['Q6', 'Q7', 'Q8', 'Q9', 'Q10'].includes(id) ? denied : { ok: true } })), create: ['Q6', 'Q8', 'Q9', 'Q10'].includes(id) ? denied : { ok: true } }; }
/** Each literal pair stands independently of the implementation's returned data. */
const literal = (value: string): unknown => ({ revision: ['A', 'B', 'C'].indexOf(value) + 1, currentRevision: ['A', 'B', 'C'].indexOf(value) + 1, value });
/** Build one completely qualifying recorded scenario from the fixed ledger and explicit intended outcomes. */
export function scenario(row: ILedgerRow): IStageRecord[] {
    const opened = new Set<string>(), active = new Set<string>(), closed = new Set<string>();
    let failed = false;
    return row.orderedCommands.map((stage, index) => {
        const [role = '', action = ''] = stage.split('.');
        let kind = 'ok';
        const payload: Record<string, unknown> = {};
        const normalized = action.replace(/-if-(?:open|success|pair-success)$/u, '');
        if (action === 'profile') {
            payload.profile = profile(row.id);
        }
        else if (action === 'open' || action === 'open-delete' || action === 'open-writable' || action === 'open-readonly') {
            opened.add(role);
            payload.addon = { path: '/pinned/addon.node', sha256: 'c'.repeat(64) };
            if (row.id === 'Q11' && role === 'R') {
                kind = 'failed';
                failed = true;
                closed.add(role);
                payload.failure = { type: 'SqliteError', code: 'SQLITE_CANTOPEN', message: 'missing' };
                payload.cleanup = { kind: 'closed', failures: [] };
            }
        }
        else if (normalized === 'begin') {
            if (failed && action.includes('-if-')) {
                kind = 'skipped';
            }
            else {
                active.add(role);
            }
        }
        else if (action.startsWith('commit') && action !== 'commitB-blocked') {
            payload.pair = literal(action.slice(6, 7));
        }
        else if (action === 'holdUncommittedC') {
            payload.uncommitted = true;
        }
        else if (action === 'rollbackC') {
            payload.uncommitted = false;
        }
        else if (action === 'hot-seedA') {
            payload.rows = { count: 64, bytes: 4096 };
            payload.synchronous = { synchronous: 2 };
        }
        else if (action.startsWith('checkpoint')) {
            payload.checkpoint = [action.includes('blocked') ? { busy: 1, log: 6, checkpointed: 4 } : { busy: 0, log: 0, checkpointed: 0 }];
            payload.elapsed = 1;
        }
        else if (action === 'commitB-blocked') {
            kind = 'failed';
            payload.failure = { type: 'SqliteBusyError', code: 'SQLITE_BUSY', message: 'busy' };
        }
        else if (action === 'metaB') {
            payload.meta = { revision: 2 };
        }
        else if (action === 'currentC') {
            payload.current = { revision: 3, value: 'C' };
        }
        else if (action === 'fake-end') {
            payload.claimedEnded = true;
        }
        else if (action === 'native-overflow-and-cleanup' || action === 'fixed-caller-failure-and-cleanup') {
            kind = 'failed';
            payload.failure = action.startsWith('native') ? { type: 'SqliteError', code: 'SQLITE_ERROR', message: 'integer overflow' } : { type: 'Error', code: null, message: 'fixed-caller-failure' };
            payload.overflowDiagnostic = { form: 'integer', reader: true };
            payload.cleanup = { kind: 'closed', failures: [] };
            active.delete(role);
            closed.add(role);
        }
        else if (action === 'nested-begin-refused' || action.startsWith('read-after')) {
            kind = 'refused';
        }
        else if (normalized.startsWith('anchor')) {
            if (failed) {
                kind = 'skipped';
            }
            else if (['Q12', 'Q13', 'Q14', 'Q15'].includes(row.id)) {
                kind = 'failed';
                failed = true;
                payload.failure = { type: 'SqliteError', code: row.id === 'Q15' ? 'SQLITE_READONLY_ROLLBACK' : 'SQLITE_ERROR', message: 'selected input refused' };
                payload.cleanup = { kind: 'closed', failures: [] };
                closed.add(role);
                active.delete(role);
            }
            else {
                payload.pair = literal(row.id === 'Q3' || role === 'R2' ? 'C' : row.id === 'C-stale' ? 'A' : 'B');
            }
        }
        else if (normalized === 'runtime') {
            if (failed) {
                kind = 'skipped';
            }
            else {
                payload.runtime = { version: { version: '3.51.0', source_id: 'source-id' }, options: [{ compile_options: 'THREADSAFE=2' }] };
            }
        }
        else if (normalized.startsWith('read')) {
            payload.pair = literal(role === 'V' || role === 'R2' ? 'C' : row.id === 'C-stale' ? 'A' : row.id === 'Q3' ? 'C' : 'B');
        }
        else if (normalized === 'end' || action === 'real-end') {
            active.delete(role);
        }
        else if (action === 'close' || action === 'close-again' || action === 'exit') {
            active.delete(role);
            closed.add(role);
            payload.cleanup = { kind: 'closed', failures: [] };
            if (action === 'exit') {
                kind = 'exiting';
            }
        }
        const reader = role === 'R' || role === 'R2' || role === 'C' && row.id !== 'C-immediate' && row.id !== 'C-torn';
        const facts = reader ? { state: closed.has(role) ? 'closed' : active.has(role) ? 'active' : opened.has(role) ? 'ended' : 'new', open: opened.has(role) && !closed.has(role), inTransaction: active.has(role), readonly: true } : { open: opened.has(role) && !closed.has(role), inTransaction: null };
        if (reader && action === 'open' && !closed.has(role)) {
            facts.state = 'opened';
        }
        if (reader && action === 'status-ended') {
            facts.state = 'ended';
        }
        return { stage, reply: { id: index + 1, kind, ...payload, facts }, ...(action === 'exit' ? { exit: { code: 0, signal: null } } : {}), ...(role === 'V' && action === 'readC' ? { readerAlive: true } : {}) };
    });
}
/** Mutations preserve unrelated receipts, so a rejection tests its named contract rather than an earlier missing fixture gate. */
export function change(records: readonly IStageRecord[], stage: string, patch: Record<string, unknown>): IStageRecord[] { return records.map(value => value.stage === stage ? { ...value, reply: { ...value.reply, ...patch } } : value); }
