/** Private finite candidate: one existing-file readonly handle, one deferred transaction, fixed owned queries. */
import type { IPair } from '../src/evidence.js';
/** Native operations exposed to this adapter exclude caller SQL, callbacks, writes and escaped iterators. @internal */
export interface INativeDatabase {
    open: boolean;
    inTransaction: boolean;
    readonly readonly: boolean;
    exec(sql: string): unknown;
    close(): unknown;
    prepare(sql: string): {
        readonly reader: boolean;
        get(): unknown;
        all(): unknown[];
    };
}
/** The exact constructor authority is fixed by the experiment rather than configurable by callers. @internal */
export interface IOpenOptions {
    readonly readonly: true;
    readonly fileMustExist: true;
    readonly timeout: 500;
}
/** Cleanup distinguishes thrown undefined from successful release and retains object identity in-process. @internal */
export type IFinish = {
    readonly kind: 'closed';
} | {
    readonly kind: 'failed';
    readonly primary: unknown;
    readonly secondary: readonly unknown[];
};
/** Fixed SELECTs are the complete candidate query vocabulary; runtime queries follow the anchor. @internal */
export const fixedSql = { meta: 'SELECT revision FROM snapshot_meta WHERE singleton=1', current: 'SELECT revision,value FROM snapshot_current WHERE singleton=1', runtime: 'SELECT sqlite_version() AS version,sqlite_source_id() AS source_id', options: 'PRAGMA compile_options', integer: 'SELECT typeof(-9223372036854775808) AS form', overflow: 'SELECT abs(-9223372036854775808) AS overflow FROM snapshot_current WHERE singleton=1' } as const;
/** Usage refusal is recognized separately so healthy native lifetime survives caller misuse. @internal */
export const usageError = 'Snapshot usage refused';
/** Validate native rows at the boundary rather than casting SQLite's unknown return. */
function row(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('Expected fixture row');
    }
    return value as Record<string, unknown>;
}
/** One handle never reopens; unexpected native errors terminate its owned lifetime. @internal */
export class Snapshot {
    private state: 'new' | 'opened' | 'active' | 'ended' | 'closed' = 'new';
    private database: INativeDatabase | undefined;
    private anchored = false;
    private closure: IFinish | undefined;
    /** Actual overflow diagnostic is retained before sqlite3_step can throw. @internal */
    public overflowDiagnostic: {
        readonly form: unknown;
        readonly reader: boolean;
    } | undefined;
    /** Native authority is injected only for deterministic adapter regressions and the fixed worker constructor. @internal */
    public constructor(private readonly location: string, private readonly factory: (location: string, options: IOpenOptions) => INativeDatabase) { }
    /** Constructor performs no PRAGMA, prepare or data read. @internal */
    public open(): void {
        this.require('new');
        this.guard(() => {
            this.database = this.factory(this.location, { readonly: true, fileMustExist: true, timeout: 500 });
            if (!this.database.readonly || !this.database.open || this.database.inTransaction) {
                throw new Error('Native readonly authority unavailable');
            }
            this.state = 'opened';
        });
    }
    /** BEGIN remains unanchored until the first actual target prepare/get. @internal */
    public begin(): void { this.require('opened'); this.guard(() => { this.db().exec('BEGIN DEFERRED'); this.state = 'active'; }); }
    /** The first metadata/current pair establishes and documents the target snapshot. @internal */
    public anchor(): IPair {
        this.require('active');
        if (this.anchored) {
            throw new Error(usageError);
        }
        return this.guard(() => { const result = this.pair(); this.anchored = true; return result; });
    }
    /** Subsequent reads stay in the same actual native transaction. @internal */
    public read(): IPair {
        this.require('active');
        if (!this.anchored) {
            throw new Error(usageError);
        }
        return this.guard(() => this.pair());
    }
    /** Runtime instrumentation may read SQLite only after the target anchor. @internal */
    public runtime(): unknown {
        this.require('active');
        if (!this.anchored) {
            throw new Error(usageError);
        }
        return this.guard(() => ({ version: this.db().prepare(fixedSql.runtime).get(), options: this.db().prepare(fixedSql.options).all() }));
    }
    /** A real integer overflow is owned and followed by all release actions. @internal */
    public overflow(): unknown {
        this.require('active');
        if (!this.anchored) {
            throw new Error(usageError);
        }
        return this.guard(() => {
            const form = this.db().prepare(fixedSql.integer).get();
            const statement = this.db().prepare(fixedSql.overflow);
            this.overflowDiagnostic = { form: row(form).form, reader: statement.reader };
            if (!statement.reader || row(form).form !== 'integer') {
                throw new Error('Overflow trigger unproved');
            }
            return statement.get();
        });
    }
    /** Caller failure is labeled separately from a native fault and retains original identity. @internal */
    public callerFailure(): never { this.require('active'); return this.guard(() => { throw new Error('fixed-caller-failure'); }); }
    /** ROLLBACK releases only this transaction; no checkpoint or sidecar cleanup is exposed. @internal */
    public end(): void {
        if (this.state === 'closed' || this.state === 'new') {
            throw new Error(usageError);
        }
        this.guard(() => {
            if (this.db().inTransaction) {
                this.db().exec('ROLLBACK');
            }
            this.state = 'ended';
        });
    }
    /** Release attempts end then native close independently and caches even a failed result. @internal */
    public close(): IFinish {
        if (this.closure) {
            return this.closure;
        }
        const failures: unknown[] = [];
        const db = this.database;
        this.state = 'closed';
        for (const release of [() => {
                if (db?.inTransaction) {
                    db.exec('ROLLBACK');
                }
            }, () => db?.close()]) {
            try {
                release();
            }
            catch (error: unknown) {
                failures.push(error);
            }
        }
        this.closure = failures.length ? { kind: 'failed', primary: failures[0], secondary: failures.slice(1) } : { kind: 'closed' };
        return this.closure;
    }
    /** Actual native flags remain available after close and never derive from adapter claims. @internal */
    public facts(): {
        readonly state: string;
        readonly open: boolean | null;
        readonly inTransaction: boolean | null;
        readonly readonly: boolean | null;
    } { return { state: this.state, open: this.database?.open ?? null, inTransaction: this.database?.inTransaction ?? null, readonly: this.database?.readonly ?? null }; }
    /** State checks happen before native calls and therefore preserve a healthy active snapshot. */
    private require(state: typeof this.state): void {
        if (this.state !== state) {
            throw new Error(usageError);
        }
    }
    /** A handle's absence is a usage error; no implicit constructor fallback exists. */
    private db(): INativeDatabase {
        if (!this.database) {
            throw new Error(usageError);
        }
        return this.database;
    }
    /** Original native/caller thrown values remain primary while closure caches secondary faults. */
    private guard<T>(operation: () => T): T {
        try {
            return operation();
        }
        catch (error: unknown) {
            this.close();
            throw error;
        }
    }
    /** Correlation is checked by the separate literal oracle, never repaired inside the adapter. */
    private pair(): IPair {
        const meta = row(this.db().prepare(fixedSql.meta).get());
        const current = row(this.db().prepare(fixedSql.current).get());
        if (typeof meta.revision !== 'number' || typeof current.revision !== 'number' || typeof current.value !== 'string') {
            throw new TypeError('Fixture pair unavailable');
        }
        return { revision: meta.revision, currentRevision: current.revision, value: current.value };
    }
}
