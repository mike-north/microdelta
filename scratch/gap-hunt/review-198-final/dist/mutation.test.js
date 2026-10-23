/** RUN-013: author access to a real child failure cannot grant mutable text runtime provenance. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { authoring, openWorkspace, ResolutionError } from 'microdelta';
import { createNodeSqlite } from '@microdelta/machine-node';
const marker = 'SYNTHETIC-RELABELED-CHILD-8b42';
for (const mode of ['unmodified', 'mutate-rethrow', 'mutate-swallow']) {
    test(`${mode}: real child failure preserves safe outer text and refuses parent publication`, async () => {
        const directory = mkdtempSync(join(tmpdir(), 'microdelta-child-mutation-'));
        const location = join(directory, 'history.sqlite');
        const api = authoring();
        let mutations = 0;
        let mutated;
        const mutate = (error) => {
            if (!(error instanceof Error)) {
                throw new Error('Expected an ordinary public Error instance');
            }
            mutations += 1;
            mutated = error;
            error.message = marker;
        };
        const child = api.memo({ subject: 'invalid-child', run: () => ({ amount: () => 0 }) });
        const parent = mode === 'unmodified'
            ? api.memo({ subject: 'parent', children: { child }, run: async ({ calls }) => { const result = await calls.child(); return { amount: result.data.amount }; } })
            : mode === 'mutate-rethrow'
                ? api.memo({ subject: 'parent', children: { child }, run: async ({ calls, helpers }) => { try {
                        const result = await calls.child();
                        return { amount: result.data.amount };
                    }
                    catch (error) {
                        helpers.mutate(error);
                        throw error;
                    } } })
                : api.memo({ subject: 'parent', children: { child }, run: async ({ calls, helpers }) => { try {
                        await calls.child();
                    }
                    catch (error) {
                        helpers.mutate(error);
                    } return { amount: 0 }; } });
        const composition = api.compose({ scope: 'child-mutation', helpers: [{ slot: 'mutate', helper: mutate }], steps: [{ slot: 'child', declaration: child }, { slot: 'parent', declaration: parent }] });
        const workspace = openWorkspace({ location, logicalStore: 'child-mutation' });
        let completed = false;
        let failure;
        try {
            failure = await workspace.run({ authoring: api, composition, environment: 'env:test' }, run => run.resolve({ scope: 'child-mutation', role: 'step', slot: 'parent' }, { requestKey: 'first' })).then(() => { completed = true; return undefined; }, (error) => error);
        }
        finally {
            workspace.close();
        }
        const sqlite = createNodeSqlite().openSqlite(location);
        try {
            const rows = sqlite.prepare('SELECT count(*) AS count FROM history_results').get();
            console.log('child-mutation-observation', JSON.stringify({ mode, outerCode: failure instanceof ResolutionError ? failure.code : null, outerMessage: failure instanceof Error ? failure.message : null, outerIsMutated: failure === mutated, mutations, completed, rows }));
            expect(failure).toBeInstanceOf(ResolutionError);
            expect(completed).toBe(false);
            expect(rows).toEqual({ count: 0 });
            expect(mutations).toBe(mode === 'unmodified' ? 0 : 1);
            if (!(failure instanceof ResolutionError)) {
                throw new Error('Expected typed runtime failure');
            }
            expect(failure.code).toBe('unsupported-result');
            expect(failure.message).not.toContain(marker);
        }
        finally {
            sqlite.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });
}
