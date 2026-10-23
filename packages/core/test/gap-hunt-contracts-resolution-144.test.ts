/**
 * Five finite witnesses pin the current Resolution contract at issue #144's
 * fault sites. They inspect public outcomes or History records so the mutation
 * controls do not depend on private digest or evidence-reader helpers.
 * @see ../../../../docs/spec/tracking.md (TRK-2)
 * @see ../../../../docs/spec/composition.md (CMP-5, CMP-8)
 * @see ../../../../docs/spec/execution.md (RES-003, REUSE-008, PUB-004)
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { createNodeMachine } from '@microdelta/machine-node';
import { createResolution } from '@microdelta/resolution';
import { createTrackingObserver } from '@microdelta/tracking';
import { authoring, openWorkspace } from 'microdelta';
import { cleanup, controlledClock, freshLocation, openHistory } from './durable-history/support.js';
import { resetWorld as resetFold } from './fold/fixture.js';
import { foldReference, publishCrafted, readProvenanceRecord, runFold } from './fold/support.js';
import { resetWorld as resetNested } from './nested/fixture.js';
import { openNestedSession, referenceOf, resolveSummaries } from './nested/support.js';
/** Test compositions that have no caller-provided input or helper bindings. */
type IEmpty = Record<never, never>;
afterEach(cleanup);
/** Narrow stored opaque content only to the record operations this integrity probe needs. */
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) { throw new Error('Expected stored record'); }
  return Object.fromEntries(Object.entries(value));
}
/** Remove just the required own implementation fact; all other evidence remains unchanged. */
function withoutOwn(content: unknown): Record<string, unknown> {
  const stored = record(content);
  const observations: unknown = stored.observations;
  if (!Array.isArray(observations)) { throw new Error('Expected observations'); }
  const selected = observations.filter((item: unknown) => {
    const observation = record(item);
    const path: unknown = record(observation.binding).path;
    return !(observation.kind === 'implementation' && Array.isArray(path) && path.length === 1 && path[0] === 'self');
  });
  expect(selected.length).toBe(observations.length - 1);
  return { ...stored, observations: selected };
}

describe('gap hunt existing issue #144 Resolution fault sites', () => {
  test('a successful gate carries its own implementation observation in its separate gate evidence', async () => {
    const builders = authoring<IEmpty, IEmpty>();
    /** A complete keyed roster gives the template a successful, observable member gate. */
    interface IRoster { readonly members: readonly { readonly id: string; readonly score: number }[]; readonly status: 'complete' }
    const roster = builders.source<IRoster>({ subject: 'roster', collection: { identity: 'id' }, run: ({ outcome }) => outcome.fresh<IRoster>({ members: [{ id: 'ada', score: 2 }], status: 'complete' }) });
    const template = builders.template({ slot: 'person', collection: roster, gate: ({ member }) => member.score > 0, steps: member => ({ result: member.memo({ subject: member.subject('result'), run: () => ({ value: 1 }) }) }) });
    const composition = builders.compose({ scope: 'gate144', steps: [{ slot: 'roster', declaration: roster }], templates: [template], inputs: [], helpers: [] });
    const workspace = openWorkspace({ location: freshLocation(), logicalStore: 'gate144' });
    try {
      const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, run => run.resolveMembers({ template: 'person', step: 'result' }, { requestKey: 'gate144' }));
      const gate = result.value.members[0]?.gate;
      expect(gate?.selected).toBe('required');
      expect(gate?.observations).toContainEqual(expect.objectContaining({ kind: 'implementation', binding: { path: ['self'] } }));
    } finally { workspace.close(); }
  });

  test('two concurrent calls of the same direct memo in one parent request execute once and share its result', async () => {
    /** The only helper records child-body executions so request-local sharing has an observable result. */
    interface IHelpers { readonly trace: () => void }
    let bodies = 0;
    const builders = authoring<IEmpty, IHelpers>();
    const child = builders.memo({ subject: 'child', run: ({ helpers }) => { helpers.trace(); return { value: 7 }; } });
    const parent = builders.memo({ subject: 'parent', children: { child }, run: async ({ calls }) => {
      const firstPending = calls.child();
      const secondPending = calls.child();
      const first = await firstPending;
      const second = await secondPending;
      return { total: first.data.value + second.data.value };
    } });
    const composition = builders.compose({ scope: 'share144', steps: [{ slot: 'child', declaration: child }, { slot: 'parent', declaration: parent }], inputs: [], helpers: [{ slot: 'trace', helper: () => { bodies += 1; } }] });
    const workspace = openWorkspace({ location: freshLocation(), logicalStore: 'share144' });
    try {
      const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async run => {
        const outcome = await run.resolve({ scope: 'share144', role: 'step', slot: 'parent' }, { requestKey: 'share144' });
        if (outcome.kind !== 'published') { throw new Error(`Expected publication, got ${outcome.kind}`); }
        return run.read<unknown>(outcome.reference);
      });
      expect(result.value).toEqual({ total: 14 });
      expect(bodies).toBe(1);
    } finally { workspace.close(); }
  });

  test('supplied attempt intent is stable for equal invocations and changes with arguments or implementation', async () => {
    /** The stored attempt digest is observed through History's allocation port, not Resolution internals. */
    interface IInputs { readonly config: { readonly value: number } }
    /** Resolve one supplied call and return the exact intent recorded by History. */
    async function intent(value: number, changed: boolean): Promise<string> {
      const builders = authoring<IInputs, IEmpty>();
      const slot = builders.stepSlot<readonly [number], { readonly score: number }>({ slot: 'score' });
      const supplied = changed
        ? builders.suppliedStep<readonly [number], { readonly score: number }>({ run: ({ args }) => ({ score: args[0] + 1 }) })
        : builders.suppliedStep<readonly [number], { readonly score: number }>({ run: ({ args }) => ({ score: args[0] }) });
      const parent = builders.memo({ subject: 'parent', children: { score: slot }, run: async ({ inputs, calls }) => ({ score: (await calls.score(inputs.config.value)).data.score }) });
      const composition = builders.compose({ scope: 'intent144', steps: [{ slot: 'parent', declaration: parent }], inputs: [{ slot: 'config', value: { value } }], helpers: [], supplied: [builders.supply({ slot, declaration: supplied, subject: () => 'supplied-score' })] });
      const history = openHistory({ location: freshLocation(), store: 'intent144', clock: controlledClock(1000) });
      const acquired = history.acquireWriter({ holder: 'intent144', leaseMilliseconds: 100000 });
      if (acquired.kind !== 'acquired') { throw new Error('Expected writer'); }
      const intents: string[] = [];
      const observed = { ...history, allocateAttempt: ((lease, request) => {
        if (request.subject === 'supplied-score') { intents.push(request.intentDigest); }
        return history.allocateAttempt(lease, request);
      }) satisfies typeof history.allocateAttempt };
      const host = createNodeMachine();
      const resolution = createResolution({ declarations: builders, composition, bindings: { inputs: ['config'], helpers: [] }, environment: 'test', history: observed, tracking: createTrackingObserver(host), host, admission: { admit: () => ({ kind: 'admitted' }) } });
      try {
        const outcome = await resolution.resolve({ step: { scope: 'intent144', role: 'step', slot: 'parent' }, requestKey: 'intent144', lease: acquired.lease });
        expect(outcome.kind).toBe('published');
        expect(intents).toHaveLength(1);
        const found = intents[0];
        if (found === undefined) { throw new Error('Missing supplied intent'); }
        return found;
      } finally { history.releaseWriter(acquired.lease); history.close(); }
    }
    const original = await intent(3, false);
    expect(await intent(3, false)).toBe(original);
    expect(await intent(4, false)).not.toBe(original);
    expect(await intent(3, true)).not.toBe(original);
  });

  test('a supplied candidate missing its required own implementation is integrity damage before acceptance', async () => {
    resetNested();
    const session = openNestedSession(freshLocation());
    try {
      const cold = await resolveSummaries(session);
      const parent = session.history.readEnvelope({ kind: 'completed-result', locator: referenceOf(cold['person:ada']) });
      const calls: unknown = record(parent.provenance.content).calls;
      if (!Array.isArray(calls)) { throw new Error('Expected calls'); }
      const supplied = calls.map((call: unknown) => {
        const locator: unknown = record(record(call).reference).locator;
        if (typeof locator !== 'string') { throw new Error('Expected reference'); }
        return session.history.readEnvelope({ kind: 'completed-result', locator });
      }).find(envelope => record(envelope.provenance.content).kind === 'supplied');
      if (supplied === undefined) { throw new Error('Expected supplied child'); }
      const attempt = session.history.allocateAttempt(session.lease, { analysis: supplied.analysis, environment: supplied.environment, subject: supplied.subject, version: supplied.version, attemptKey: 'crafted144', intentDigest: 'crafted144' });
      session.history.stageAttempt(session.lease, { attemptId: attempt.attemptId, payload: session.history.reader.readSubtree(supplied.reference, []), dependencies: supplied.dependencies, provenance: { ...supplied.provenance, content: withoutOwn(supplied.provenance.content) } });
      session.history.publishAttempt(session.lease, attempt.attemptId);
      await expect(session.resolve(session.nested.steps['person:ada'].summary)).rejects.toMatchObject({ code: 'integrity' });
    } finally { session.close(); }
  });

  test('a fold candidate missing its required own implementation is integrity damage before acceptance', async () => {
    resetFold();
    const location = freshLocation();
    const cold = await runFold(location);
    const original = readProvenanceRecord(location, foldReference(cold));
    publishCrafted(location, foldReference(cold), { ...original, content: withoutOwn(original.content) });
    const result = await runFold(location);
    expect(result.fold).toMatchObject({ status: 'error', code: 'integrity' });
  });
});
