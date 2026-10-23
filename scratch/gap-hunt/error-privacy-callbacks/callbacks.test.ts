/** RUN-013: author-owned error text belongs only in the exact cause, across four supported execution APIs. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { ResolutionError, authoring, openWorkspace } from 'microdelta';
import { createNodeSqlite } from '@microdelta/machine-node';

/** Synthetic author text, never a real credential or provider response. */
const marker = 'SYNTHETIC-CALLBACK-DETAIL-4c81';
/** All error creation and mutable counters remain at the bound helper boundary. */
interface IHelpers { readonly fail: () => never }
interface IMember { readonly key: string; readonly score: number }
interface IListing { readonly status: 'complete'; readonly members: readonly IMember[] }
const routes = ['source', 'supplied', 'strict-fold', 'outcome-fold'] as const;
const modes = ['plain-error', 'author-resolution-error'] as const;

for (const route of routes) {
  for (const mode of modes) {
    test(`${route}/${mode}: outer framework failure keeps authored text in exact cause`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'microdelta-callback-privacy-'));
      const location = join(directory, 'history.sqlite');
      const api = authoring<Record<string, never>, IHelpers>();
      const thrown = mode === 'plain-error' ? new Error(marker) : new ResolutionError('unsupported-result', marker);
      let calls = 0;
      const fail = (): never => { calls += 1; throw thrown; };
      const helperBindings = [{ slot: 'fail', helper: fail }];
      const scope = 'callback-privacy';
      const subject = 'authored-failure';
      const workspace = openWorkspace({ location, logicalStore: 'callback-privacy' });
      let completedResult = false;
      let failure: unknown;
      try {
        if (route === 'source') {
          const declaration = api.source({ subject, run: ({ helpers }) => helpers.fail() });
          const composition = api.compose({ scope, helpers: helperBindings, steps: [{ slot: 'value', declaration }] });
          failure = await workspace.run({ authoring: api, composition, environment: 'env:test' }, run => run.resolve({ scope, role: 'step', slot: 'value' }, { requestKey: 'cold' })).then(() => { completedResult = true; return undefined; }, (error: unknown) => error);
        } else if (route === 'supplied') {
          const slot = api.stepSlot<readonly [], { readonly value: number }>({ slot: 'supplied' });
          const declaration = api.suppliedStep<readonly [], { readonly value: number }>({ run: ({ helpers }) => helpers.fail() });
          const parent = api.memo({ subject: 'parent', children: { child: slot }, run: async ({ calls: children }) => { const child = await children.child(); return { value: child.data.value }; } });
          const composition = api.compose({ scope, helpers: helperBindings, steps: [{ slot: 'value', declaration: parent }], supplied: [api.supply({ slot, declaration, subject: () => subject })] });
          failure = await workspace.run({ authoring: api, composition, environment: 'env:test' }, run => run.resolve({ scope, role: 'step', slot: 'value' }, { requestKey: 'cold' })).then(() => { completedResult = true; return undefined; }, (error: unknown) => error);
        } else {
          const listing = api.source<IListing>({ subject: 'listing', collection: { identity: 'key' }, run: ({ outcome }) => outcome.fresh<IListing>({ status: 'complete', members: [{ key: 'one', score: 1 }] }) });
          const template = api.template({ slot: 'member', collection: listing, steps: member => ({ score: member.memo({ subject: member.subject('score'), run: ({ member: bound }) => ({ score: bound.score }) }) }) });
          const over = { template, step: 'score' } as const;
          const declaration = route === 'strict-fold'
            ? api.fold({ subject, over, run: ({ helpers }) => helpers.fail() })
            : api.outcomeFold({ subject, over, run: ({ helpers }) => helpers.fail() });
          const composition = api.compose({ scope, helpers: helperBindings, steps: [{ slot: 'listing', declaration: listing }, { slot: 'value', declaration }], templates: [template] });
          failure = await workspace.run({ authoring: api, composition, environment: 'env:test' }, async run => { if (route === 'strict-fold') { await run.resolveFold({ scope, role: 'step', slot: 'value' }, { requestKey: 'cold' }); } else { await run.resolveOutcomeFold({ scope, role: 'step', slot: 'value' }, { requestKey: 'cold' }); } }).then(() => { completedResult = true; return undefined; }, (error: unknown) => error);
        }
      } finally { workspace.close(); }
      const sqlite = createNodeSqlite().openSqlite(location);
      try {
        // A supplied failure crosses its memo caller, which may add a safe framework wrapper.
        const boundaryFailure = route === 'supplied' && failure instanceof ResolutionError && failure.cause instanceof ResolutionError ? failure.cause : failure;
        const failedStepResults = sqlite.prepare('SELECT count(*) AS count FROM history_results WHERE subject = ?').get(subject);
        console.log('callback-observation', JSON.stringify({ route, mode, outerCode: failure instanceof ResolutionError ? failure.code : null, outerMessage: failure instanceof Error ? failure.message : null, outerIsThrown: failure === thrown, causeIsThrown: failure instanceof ResolutionError && failure.cause === thrown, boundaryCauseIsThrown: boundaryFailure instanceof ResolutionError && boundaryFailure.cause === thrown, calls, completedResult, failedStepResults }));
        expect(failure).toBeInstanceOf(ResolutionError);
        expect(calls).toBe(1);
        expect(completedResult).toBe(false);
        expect(failedStepResults).toEqual({ count: 0 });
        if (!(failure instanceof ResolutionError)) { throw new Error('Expected typed framework failure'); }
        expect(failure.message).not.toContain(marker);
        expect(failure.code).toBe('execution-failure');
        expect(boundaryFailure instanceof ResolutionError ? boundaryFailure.cause : undefined).toBe(thrown);
      } finally { sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
    });
  }
}
