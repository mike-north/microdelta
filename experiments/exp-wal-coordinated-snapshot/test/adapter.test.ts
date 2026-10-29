/** Adapter-only assertions express selected authority and finite release; no SQLite is loaded. */
import { describe, expect, test } from '@jest/globals';
import { Snapshot, usageError, fixedSql } from '../node/adapter.js';
import type { INativeDatabase } from '../node/adapter.js';
/** A finite native port records every requested operation and allows independent cleanup faults. */
function fixture(): {
    readonly db: INativeDatabase;
    readonly calls: string[];
    failEnd?: unknown;
    failClose?: unknown;
} {
    const calls: string[] = [];
    const result: {
        db: INativeDatabase;
        calls: string[];
        failEnd?: unknown;
        failClose?: unknown;
    } = { calls, db: {
            open: true, inTransaction: false, readonly: true,
            exec(sql) {
                calls.push(sql);
                if (sql === 'ROLLBACK' && 'failEnd' in result) {
                    throw result.failEnd;
                }
                this.inTransaction = sql.startsWith('BEGIN');
            },
            close() {
                calls.push('close');
                if ('failClose' in result) {
                    throw result.failClose;
                }
                this.open = false;
            },
            prepare(sql) { calls.push(sql); return { reader: true, get: () => sql === fixedSql.meta ? { revision: 2 } : { revision: 2, value: 'B' }, all: () => [] }; },
        } };
    return result;
}
describe('finite readonly snapshot adapter', () => {
    test('a constructor that fails to deliver native readonly authority is rejected and closed', () => {
        const f = fixture();
        const unexpected = { ...f.db, readonly: false };
        const r = new Snapshot('/fixture', () => unexpected);
        expect(() => r.open()).toThrow('Native readonly authority unavailable');
        expect(f.calls).toEqual(['close']);
    });
    test('constructor and BEGIN do not prepare the first target or runtime query', () => {
        const f = fixture();
        const options: unknown[] = [];
        const r = new Snapshot('/fixture', (location, opts) => { options.push(location, opts); return f.db; });
        r.open();
        r.begin();
        expect(options).toEqual(['/fixture', { readonly: true, fileMustExist: true, timeout: 500 }]);
        expect(f.calls).toEqual(['BEGIN DEFERRED']);
        expect(() => r.runtime()).toThrow(usageError);
        expect(r.anchor()).toEqual({ revision: 2, currentRevision: 2, value: 'B' });
        expect(f.calls.slice(1)).toEqual([fixedSql.meta, fixedSql.current]);
    });
    test('misuse refuses before native work and leaves active snapshot healthy', () => {
        const f = fixture();
        const r = new Snapshot('/fixture', () => f.db);
        r.open();
        r.begin();
        r.anchor();
        const count = f.calls.length;
        expect(() => r.begin()).toThrow(usageError);
        expect(f.calls).toHaveLength(count);
        expect(f.db.inTransaction).toBe(true);
        expect(r.read().value).toBe('B');
        r.end();
        const ended = f.calls.length;
        expect(() => r.read()).toThrow(usageError);
        expect(f.calls).toHaveLength(ended);
        r.close();
        const closed = f.calls.length;
        expect(r.close()).toEqual({ kind: 'closed' });
        expect(() => r.open()).toThrow(usageError);
        expect(() => r.read()).toThrow(usageError);
        expect(f.calls).toHaveLength(closed);
    });
    test('all cleanup actions run and cached failure preserves thrown undefined and secondary identity', () => {
        const f = fixture();
        const later = new Error('close');
        f.failEnd = undefined;
        f.failClose = later;
        const r = new Snapshot('/fixture', () => f.db);
        r.open();
        r.begin();
        const outcome = r.close();
        expect(outcome).toEqual({ kind: 'failed', primary: undefined, secondary: [later] });
        expect(f.calls).toEqual(['BEGIN DEFERRED', 'ROLLBACK', 'close']);
        expect(r.close()).toBe(outcome);
    });
    test('unexpected query failure preserves original failure while attempting end and close', () => {
        const f = fixture();
        const primary = new Error('query');
        f.db.prepare = () => { throw primary; };
        const r = new Snapshot('/fixture', () => f.db);
        r.open();
        r.begin();
        expect(() => r.anchor()).toThrow(primary);
        expect(f.calls).toEqual(['BEGIN DEFERRED', 'ROLLBACK', 'close']);
        expect(r.facts().state).toBe('closed');
    });
});
