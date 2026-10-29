/** Fixed finite host worker separates readonly candidate from writable fixture/control authority. */
import { createHash } from 'node:crypto';
import { open, unlink, lstat, statfs, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { endianness } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createNodeSqlite } from '@microdelta/machine-node';
import type { ISqliteConnection } from '@microdelta/machine';
import { Snapshot, usageError, fixedSql } from './adapter.js';
import { record } from './peer.js';
/** A fixed role/path pair cannot be changed by protocol commands. */
const role = process.argv[2], location = process.argv[3];
if (!role || !['W', 'R', 'R2', 'V', 'C'].includes(role) || !location) {
    throw new Error('Expected bounded worker role/path');
}
const source = location;
/** Module cache reveals the lazy-loaded addon, including thrown-open paths. */
const require = createRequire(import.meta.url);
let writer: ISqliteConnection | undefined;
let control: Database.Database | undefined;
let snapshot: Snapshot | undefined;
let overflowDiagnostic: unknown;
/** The candidate has no reopen fallback. */
function candidate(): Snapshot {
    if (!snapshot) {
        throw new Error(usageError);
    }
    return snapshot;
}
/** Finite summaries preserve native code and class while original thrown objects stay in-process. */
function facts(error: unknown): unknown { return { type: error instanceof Error ? error.name : typeof error, message: (error instanceof Error ? error.message : String(error)).slice(0, 1024), code: record(error) && typeof error.code === 'string' ? error.code : null, cause: record(error) && record(error.cause) ? { message: typeof error.cause.message === 'string' ? error.cause.message.slice(0, 1024) : null, code: typeof error.cause.code === 'string' ? error.cause.code : null } : null }; }
/** Addon identity is measured after construction; static profiles never pretend native loading occurred. */
async function addon(): Promise<unknown> {
    const paths = Object.keys(require.cache).filter(path => path.endsWith('.node') && path.includes('better-sqlite3'));
    if (paths.length !== 1) {
        throw new Error('Ambiguous loaded addon identity');
    }
    const path = paths[0];
    if (!path) {
        throw new Error('Loaded addon missing');
    }
    const bytes = await readFile(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== process.env.WAL302_ADDON_SHA) {
        throw new Error('Loaded addon differs from frozen binary');
    }
    return { path, bytes: bytes.length, sha256 };
}
/** Pathname witnesses close every handle without writing SQLite files. */
async function witness(path: string, flags: 'r' | 'r+' | 'wx'): Promise<unknown> {
    let handle;
    try {
        handle = await open(path, flags);
        return { ok: true };
    }
    catch (error: unknown) {
        return { ok: false, error: facts(error) };
    }
    finally {
        if (handle) {
            await handle.close();
        }
    }
}
/** Unique non-SQLite directory witness completes before attributed images; no identities or ACLs change. */
async function profile(): Promise<unknown> {
    const files: unknown[] = [];
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
        const path = source + suffix;
        let stat: unknown;
        try {
            const info = await lstat(path);
            stat = { mode: info.mode, uid: info.uid, gid: info.gid, dev: info.dev, ino: info.ino, size: info.size, regular: info.isFile() };
        }
        catch (error: unknown) {
            stat = { error: facts(error) };
        }
        files.push({ suffix, stat, read: await witness(path, 'r'), readWrite: await witness(path, 'r+') });
    }
    const probe = join(dirname(source), `permission-${process.pid}.probe`);
    const create = await witness(probe, 'wx');
    if (record(create) && create.ok === true) {
        await unlink(probe);
    }
    const fs = await statfs(dirname(source));
    const packagePath = fileURLToPath(import.meta.resolve('better-sqlite3/package.json'));
    const packageBytes = await readFile(packagePath);
    const entry = fileURLToPath(import.meta.url);
    return { execPath: process.execPath, node: process.version, platform: process.platform, arch: process.arch, nativeByteOrder: endianness(), pid: process.pid, uid: process.geteuid?.(), gid: process.getegid?.(), groups: process.getgroups?.(), umask: process.umask(), files, create, filesystem: { type: fs.type, device: (await lstat(dirname(source))).dev }, entry, entrySha256: createHash('sha256').update(await readFile(entry)).digest('hex'), bindingPackage: packagePath, packageSha256: createHash('sha256').update(packageBytes).digest('hex'), binding: JSON.parse(packageBytes.toString()) as unknown };
}
/** W/V alone consume generated public Machine declarations and fixed writer operations. */
function owner(): ISqliteConnection {
    if (!writer) {
        throw new Error('Fixture owner unopened');
    }
    return writer;
}
/** Literal A/B/C revisions are the entire ordinary domain fixture. */
function commit(value: 'A' | 'B' | 'C'): void { const revision = ['A', 'B', 'C'].indexOf(value) + 1; const db = owner(); db.transaction(() => { db.prepare('INSERT INTO snapshot_meta VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision').run(revision); db.prepare('INSERT INTO snapshot_current VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,value=excluded.value').run(revision, value); }); }
/** Exactly two singleton tables define correlated target reads. */
function initialize(): void { owner().exec('CREATE TABLE snapshot_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL) STRICT; CREATE TABLE snapshot_current(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL,value TEXT NOT NULL) STRICT'); }
/** All independent cleanup actions are attempted; original and secondary values remain separate. */
function close(): unknown {
    const failures: unknown[] = [];
    if (snapshot) {
        const outcome = snapshot.close();
        if (outcome.kind === 'failed') {
            failures.push(outcome.primary, ...outcome.secondary);
        }
    }
    for (const action of [() => {
            if (control?.inTransaction) {
                control.exec('ROLLBACK');
            }
        }, () => {
            if (control?.open) {
                control.close();
            }
        }, () => writer?.close()]) {
        try {
            action();
        }
        catch (error: unknown) {
            failures.push(error);
        }
    }
    writer = undefined;
    return { kind: failures.length ? 'failed' : 'closed', failures: failures.map(facts) };
}
/** No command carries caller SQL, constructor options, native handles or paths. */
async function execute(action: string): Promise<unknown> {
    if (action === 'profile') {
        return { profile: await profile() };
    }
    if (action === 'status' || action.startsWith('status-')) {
        return { facts: snapshot?.facts() ?? { open: control?.open ?? false, inTransaction: control?.inTransaction ?? false } };
    }
    if (action === 'exit') {
        return { kind: 'exiting', cleanup: close() };
    }
    if (action === 'close' || action === 'close-again') {
        return { cleanup: close() };
    }
    if (role === 'W' || role === 'V') {
        if (action === 'open' || action === 'open-delete') {
            if (writer) {
                throw new Error('Owner cannot reopen');
            }
            writer = createNodeSqlite().openSqlite(source, action === 'open-delete' ? { journalMode: 'delete' } : undefined);
            return { addon: await addon() };
        }
        if (action === 'init') {
            initialize();
            return {};
        }
        if (action === 'foreign-seed') {
            owner().exec('CREATE TABLE foreign_only(value TEXT); INSERT INTO foreign_only VALUES(\'foreign\')');
            return {};
        }
        if (action === 'hot-seedA') {
            initialize();
            commit('A');
            owner().exec('CREATE TABLE padding(id INTEGER PRIMARY KEY,payload BLOB NOT NULL)');
            const stmt = owner().prepare('INSERT INTO padding VALUES(?,?)');
            owner().transaction(() => {
                for (let id = 1; id <= 64; id++) {
                    stmt.run(id, new Uint8Array(4096).fill(0x11));
                }
            });
            owner().exec('PRAGMA cache_size=4; PRAGMA cache_spill=ON');
            return { rows: owner().prepare('SELECT count(*) AS count,length(payload) AS bytes FROM padding').get(), synchronous: owner().prepare('PRAGMA synchronous').get() };
        }
        if (action === 'hold-spilled-update') {
            owner().exec('BEGIN IMMEDIATE; UPDATE snapshot_meta SET revision=2; UPDATE snapshot_current SET revision=2,value=\'B\'');
            owner().prepare('UPDATE padding SET payload=?').run(new Uint8Array(4096).fill(0x22));
            return {};
        }
        if (action.startsWith('commit')) {
            const value = action.slice(6, 7);
            if (value !== 'A' && value !== 'B' && value !== 'C') {
                throw new Error('Unlisted fixture revision');
            }
            commit(value);
            return { pair: owner().prepare('SELECT m.revision,c.revision AS currentRevision,c.value FROM snapshot_meta m,snapshot_current c').get() };
        }
        if (action.startsWith('checkpoint')) {
            const start = performance.now();
            return { checkpoint: owner().prepare('PRAGMA wal_checkpoint(TRUNCATE)').all(), elapsed: performance.now() - start };
        }
        if (action === 'holdUncommittedC') {
            owner().exec('BEGIN IMMEDIATE; UPDATE snapshot_meta SET revision=3; UPDATE snapshot_current SET revision=3,value=\'C\'');
            return { uncommitted: true };
        }
        if (action === 'rollbackC') {
            owner().exec('ROLLBACK');
            return { uncommitted: false };
        }
        if (action === 'readC') {
            return { pair: owner().prepare('SELECT m.revision,c.revision AS currentRevision,c.value FROM snapshot_meta m,snapshot_current c').get() };
        }
        throw new Error('Owner action outside fixed vocabulary');
    }
    if (role === 'C' && action === 'open-writable') {
        writer = createNodeSqlite().openSqlite(source);
        return { addon: await addon() };
    }
    if (role === 'C' && action === 'begin-immediate') {
        owner().exec('BEGIN IMMEDIATE');
        return {};
    }
    if (role === 'C' && action === 'rollback') {
        owner().exec('ROLLBACK');
        return {};
    }
    if (role === 'C' && action === 'open-readonly') {
        control = new Database(source, { readonly: true, fileMustExist: true, timeout: 500 });
        return { addon: await addon() };
    }
    if (role === 'C' && action === 'metaB') {
        return { meta: control?.prepare(fixedSql.meta).get() };
    }
    if (role === 'C' && action === 'currentC') {
        return { current: control?.prepare(fixedSql.current).get() };
    }
    if (role === 'C' && action === 'fake-end') {
        return { claimedEnded: true, facts: candidate().facts() };
    }
    if (action === 'open') {
        snapshot = new Snapshot(source, (path, options) => new Database(path, options));
        try {
            snapshot.open();
        }
        finally {
            await addon();
        }
        return { addon: await addon() };
    }
    const normalized = action.replace(/-if-(?:open|pair-success|success)$/u, '');
    if (normalized !== action && candidate().facts().state === 'closed') {
        return { kind: 'skipped', reason: 'previous-native-refusal' };
    }
    if (normalized === 'begin' || action === 'nested-begin-refused') {
        candidate().begin();
        return {};
    }
    if (normalized.startsWith('anchor')) {
        return { pair: candidate().anchor() };
    }
    if (normalized.startsWith('read')) {
        return { pair: candidate().read() };
    }
    if (normalized === 'runtime') {
        return { runtime: candidate().runtime() };
    }
    if (normalized === 'end' || action === 'real-end') {
        candidate().end();
        return {};
    }
    if (action === 'native-overflow-and-cleanup') {
        try {
            candidate().overflow();
            return { triggerUnproved: true };
        }
        finally {
            overflowDiagnostic = candidate().overflowDiagnostic;
            candidate().close();
        }
    }
    if (action === 'fixed-caller-failure-and-cleanup') {
        candidate().callerFailure();
    }
    throw new Error('Reader action outside fixed vocabulary');
}
/** Finite input owns no detached work; each response reports actual reader native state. */
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
try {
    let requests = 0;
    for await (const line of input) {
        if (Buffer.byteLength(line) > 256 || ++requests > 40) {
            throw new Error('Worker command bound exceeded');
        }
        const request: unknown = JSON.parse(line);
        if (!record(request) || typeof request.id !== 'number' || !Number.isSafeInteger(request.id) || typeof request.action !== 'string') {
            throw new Error('Malformed command');
        }
        try {
            const result = await execute(request.action);
            const payload = record(result) ? result : { result };
            const message = { id: request.id, kind: 'ok', ...payload, facts: snapshot?.facts() ?? { open: control?.open ?? writer !== undefined, inTransaction: control?.inTransaction ?? null } };
            const text = JSON.stringify(message) + '\n';
            if (Buffer.byteLength(text) > 8192) {
                throw new Error('Worker response exceeds line quota');
            }
            process.stdout.write(text);
        }
        catch (error: unknown) {
            const usage = error instanceof Error && error.message === usageError;
            const cleanup = usage || ((role === 'W' || role === 'V') && request.action !== 'close' && request.action !== 'exit') ? null : close();
            let loaded: unknown = null;
            if (request.action === 'open' || request.action.startsWith('open-')) {
                try {
                    loaded = await addon();
                }
                catch (identity: unknown) {
                    loaded = { identityFailure: facts(identity) };
                }
            }
            process.stdout.write(JSON.stringify({ id: request.id, kind: usage ? 'refused' : 'failed', failure: facts(error), cleanup, addon: loaded, overflowDiagnostic, facts: snapshot?.facts() ?? null }) + '\n');
        }
        if (request.action === 'exit') {
            break;
        }
    }
}
finally {
    input.close();
    const cleanup = close();
    if (record(cleanup) && cleanup.kind === 'failed') {
        process.exitCode = 1;
    }
}
