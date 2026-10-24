/**
 * RUN-013 keeps author-owned error text in the exact cause across source,
 * supplied, strict-fold and outcome-fold callback boundaries.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { ResolutionError, authoring, openWorkspace } from 'microdelta';
import { createNodeSqlite } from '@microdelta/machine-node';

/** Synthetic author text, never a real credential or provider response. */
const marker = 'SYNTHETIC-CALLBACK-DETAIL-4c81';
/** The helper is the authored boundary for both synchronous throws and rejected calls. */
interface IHelpers { readonly fail: () => Promise<never> }
/** A bound invalid-output helper makes the finish controls legal tracked author callbacks. */
interface IControlHelpers extends IHelpers { readonly invalid: () => { readonly value: number; readonly unsupported: () => number } }
/** A keyed member gives both fold kinds a real, successfully settled input. */
interface IMember { readonly key: string; readonly score: number }
/** Closed discovery lets each fold reach its own authored body. */
interface IListing { readonly status: 'complete'; readonly members: readonly IMember[] }
/** These are the four supported authored routes identified by issue #194's pinned evidence. */
const routes = ['source', 'supplied', 'strict-fold', 'outcome-fold'] as const;
/** Public codes are author-selectable; none proves that a failure was minted by Resolution. */
const modes = ['plain-error', 'primitive-string', 'primitive-null', 'unsupported-result', 'policy-failure', 'execution-failure'] as const;

for (const route of routes) {
  for (const mode of modes) {
    test(`${route}/${mode}: outer framework failure keeps authored text in exact cause`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'microdelta-callback-privacy-'));
      const location = join(directory, 'history.sqlite');
      const api = authoring<Record<string, never>, IHelpers>();
      const thrown = mode === 'plain-error'
        ? new Error(marker)
        : mode === 'primitive-string' ? marker : mode === 'primitive-null' ? null : new ResolutionError(mode, marker);
      let calls = 0;
      const fail = (): Promise<never> => {
        calls += 1;
        // The policy-failure case rejects asynchronously; the other cases throw synchronously.
        if (mode === 'policy-failure') { return Promise.reject(thrown); }
        throw thrown;
      };
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
        expect(failure).toBeInstanceOf(ResolutionError);
        expect(calls).toBe(1);
        expect(completedResult).toBe(false);
        expect(failedStepResults).toEqual({ count: 0 });
        if (!(failure instanceof ResolutionError)) { throw new Error('Expected typed framework failure'); }
        expect(failure.message).not.toContain(marker);
        expect(failure.message).toContain('value');
        expect(failure.code).toBe('execution-failure');
        expect(boundaryFailure).not.toBe(thrown);
        expect(boundaryFailure instanceof ResolutionError ? boundaryFailure.code : undefined).toBe('execution-failure');
        expect(boundaryFailure instanceof ResolutionError ? boundaryFailure.cause : undefined).toBe(thrown);
      } finally { sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
    });
  }
}

/** Runtime-generated output and observer failures must retain their own classification, not be mistaken for author-thrown instances. */
for (const route of routes) {
  for (const control of ['unsupported-output', 'pre-body-observer'] as const) {
    test(`${route}/${control}: framework failure remains distinct from an authored callback throw`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'microdelta-callback-control-'));
      const location = join(directory, 'history.sqlite');
      const api = authoring<Record<string, never>, IControlHelpers>();
      const observerError = new Error(marker);
      const invalid = { value: 1, unsupported: () => 1 };
      let calls = 0;
      const fail = (): Promise<never> => { calls += 1; throw new Error('Unexpected helper call'); };
      const produceInvalid = (): typeof invalid => { calls += 1; return invalid; };
      const helperBindings = [{ slot: 'fail', helper: fail }, { slot: 'invalid', helper: produceInvalid }];
      const scope = 'callback-control';
      const subject = 'controlled-failure';
      const workspace = openWorkspace({ location, logicalStore: 'callback-control' });
      const targetSlot = route === 'supplied' ? 'supplied' : 'value';
      const observers = control === 'pre-body-observer' ? [{ observe: (event: { readonly kind: string; readonly event?: { readonly phase: string; readonly step: { readonly slot: string } } }): void => {
        if (event.kind === 'step' && event.event?.phase === 'execute' && event.event.step.slot === targetSlot) { throw observerError; }
      } }] : [];
      let failure: unknown;
      try {
        if (route === 'source') {
          const declaration = api.source<typeof invalid>({ subject, run: ({ outcome, helpers }) => outcome.fresh(helpers.invalid()) });
          const composition = api.compose({ scope, helpers: helperBindings, steps: [{ slot: 'value', declaration }] });
          failure = await workspace.run({ authoring: api, composition, environment: 'env:test', observers }, run => run.resolve({ scope, role: 'step', slot: 'value' }, { requestKey: 'cold' })).then(() => undefined, (error: unknown) => error);
        } else if (route === 'supplied') {
          const slot = api.stepSlot<readonly [], { readonly value: number }>({ slot: 'supplied' });
          const declaration = api.suppliedStep<readonly [], { readonly value: number }>({ run: ({ helpers }) => helpers.invalid() });
          const parent = api.memo({ subject: 'parent', children: { child: slot }, run: async ({ calls: children }) => { const child = await children.child(); return { value: child.data.value }; } });
          const composition = api.compose({ scope, helpers: helperBindings, steps: [{ slot: 'value', declaration: parent }], supplied: [api.supply({ slot, declaration, subject: () => subject })] });
          failure = await workspace.run({ authoring: api, composition, environment: 'env:test', observers }, run => run.resolve({ scope, role: 'step', slot: 'value' }, { requestKey: 'cold' })).then(() => undefined, (error: unknown) => error);
        } else {
          const listing = api.source<IListing>({ subject: 'listing', collection: { identity: 'key' }, run: ({ outcome }) => outcome.fresh<IListing>({ status: 'complete', members: [{ key: 'one', score: 1 }] }) });
          const template = api.template({ slot: 'member', collection: listing, steps: member => ({ score: member.memo({ subject: member.subject('score'), run: ({ member: bound }) => ({ score: bound.score }) }) }) });
          const over = { template, step: 'score' } as const;
          const declaration = route === 'strict-fold'
            ? api.fold({ subject, over, run: ({ helpers }) => helpers.invalid() })
            : api.outcomeFold({ subject, over, run: ({ helpers }) => helpers.invalid() });
          const composition = api.compose({ scope, helpers: helperBindings, steps: [{ slot: 'listing', declaration: listing }, { slot: 'value', declaration }], templates: [template] });
          failure = await workspace.run({ authoring: api, composition, environment: 'env:test', observers }, async run => {
            if (route === 'strict-fold') { await run.resolveFold({ scope, role: 'step', slot: 'value' }, { requestKey: 'cold' }); }
            else { await run.resolveOutcomeFold({ scope, role: 'step', slot: 'value' }, { requestKey: 'cold' }); }
          }).then(() => undefined, (error: unknown) => error);
        }
      } finally { workspace.close(); }
      try {
        expect(failure).toBeInstanceOf(ResolutionError);
        if (!(failure instanceof ResolutionError)) { throw new Error('Expected typed framework failure'); }
        expect(failure.code).toBe(control === 'pre-body-observer' ? 'observer-failure' : 'unsupported-result');
        expect(failure.message).toContain(targetSlot);
        expect(failure.message).not.toContain(marker);
        if (control === 'pre-body-observer') { expect(failure.cause).toBe(observerError); }
        expect(calls).toBe(control === 'pre-body-observer' ? 0 : 1);
        const sqlite = createNodeSqlite().openSqlite(location);
        try { expect(sqlite.prepare('SELECT count(*) AS count FROM history_results WHERE subject = ?').get(subject)).toEqual({ count: 0 }); }
        finally { sqlite.close(); }
      } finally { rmSync(directory, { recursive: true, force: true }); }
    });
  }
}
