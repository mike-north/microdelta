/** RUN-007/A-16f composed proof with native outcomes and reopened durable exact reads. */
import { afterEach, expect, test } from '@jest/globals';
import { createMaterialization } from '@microdelta/materialization';
import { createTrackingObserver } from '@microdelta/tracking';

import { createPreviewProjection } from '../src/index.js';
import type { ICompletedResultReference, IPreviewEvaluation, IPreviewScope } from '../src/index.js';
import { cleanup, machine, observedSqlite, openHistory, openRaw } from './durable-history/support.js';
import { resetWorld } from './workspace/fixture.js';
import type { IActivity } from './workspace/fixture.js';
import { environment, logicalStore, openSession, tempStore } from './workspace/support.js';
import type { ISession } from './workspace/support.js';

afterEach(cleanup);

/** Capture actual run context together with a native result, including thrown failures. */
async function evaluate(session: ISession, requestKey: string): Promise<IPreviewEvaluation> {
  const { contributors } = session;
  const step = contributors.steps['person:ada'].activity;
  const result = await session.workspace.run({ authoring: contributors.authoring, composition: contributors.composition, environment }, async run => {
    const scope: IPreviewScope = { context: run.context, requestKey, step };
    try { return { kind: 'returned', scope, outcome: await run.resolve(step, { requestKey }) } satisfies IPreviewEvaluation; }
    catch (error: unknown) { return { kind: 'threw', scope, error } satisfies IPreviewEvaluation; }
  });
  return result.value;
}

/** Success extraction never treats refusal or a caught refresh error as a result. */
function referenceOf(evaluation: IPreviewEvaluation): ICompletedResultReference {
  if (evaluation.kind === 'returned' && (evaluation.outcome.kind === 'published' || evaluation.outcome.kind === 'reused')) {
    return evaluation.outcome.reference;
  }
  throw new Error('Expected a real completed result');
}

test('native publication, equal-data verification and failed refresh remain read-only after reopening History', async () => {
  const store = tempStore();
  const world = resetWorld();
  const session = openSession(store.location);
  try {
    const published = await evaluate(session, 'publish');
    expect(published).toMatchObject({ kind: 'returned', outcome: { kind: 'published' } });
    const first = referenceOf(published);
    const verified = await evaluate(session, 'verify');
    expect(verified).toMatchObject({ kind: 'returned', outcome: { kind: 'reused' } });
    expect(referenceOf(verified)).toEqual(first);
    world.final['person:ada'] = false;
    world.remote['person:ada'] = { ...world.remote['person:ada'], profile: { ...world.remote['person:ada'].profile, name: 'Later Ada' } };
    const advanced = await evaluate(session, 'advance-head');
    expect(referenceOf(advanced)).not.toEqual(first);
    Object.defineProperty(world.remote, 'person:ada', { get(): never { throw new Error('source unavailable'); }, configurable: true });
    const failed = await evaluate(session, 'failed-refresh');
    expect(failed.kind).toBe('threw');
    session.close();

    const sql = observedSqlite();
    const history = openHistory({ location: store.location, store: logicalStore, sqlite: sql.capability });
    const materialization = createMaterialization({ reader: history.reader, navigationReader: history.reader, tracking: createTrackingObserver(machine) });
    const projection = createPreviewProjection({ materializeView: materialization.materializeView });
    const raw = openRaw(store.location);
    const durableState = (): readonly unknown[] => ['history_results', 'history_acceptances', 'history_attempts', 'history_writer', 'history_current', 'history_journal'].map(table => raw.prepare(`SELECT * FROM ${table}`).all());
    const before = durableState();
    const calls = { ...world.checks };
    const finalities = { ...world.finalities };
    const mark = sql.mark();
    const retained = projection.project<IActivity>({ scope: published.scope, reference: first, evaluation: published });
    expect(retained).toMatchObject({ availability: 'available', freshness: 'current' });
    expect(projection.project({ scope: verified.scope, reference: first })).toMatchObject({ freshness: 'stale' });
    expect(projection.project({ scope: verified.scope, reference: first, evaluation: verified })).toMatchObject({ freshness: 'current' });
    expect(projection.project({ scope: advanced.scope, reference: first, evaluation: advanced })).toMatchObject({ freshness: 'stale' });
    expect(projection.project({ scope: failed.scope, reference: first, evaluation: published })).toMatchObject({ freshness: 'stale' });
    for (let index = 0; index < 25; index += 1) {
      const preview = projection.project<IActivity>({ scope: failed.scope, reference: first, evaluation: failed });
      expect(preview).toMatchObject({ availability: 'available', freshness: 'stale', refresh: { kind: 'failed' } });
      if (preview.availability !== 'available' || retained.availability !== 'available') { throw new Error('Prior result must remain available'); }
      expect(preview.value.profile.name).toBe('Ada');
      expect(retained.value.profile.name).toBe('Ada');
      expect(projection.project({ scope: failed.scope, evaluation: failed })).toMatchObject({ availability: 'unavailable', refresh: { kind: 'failed' } });
    }
    expect(sql.evidence(mark).rootPayloadCells).toBe(0);
    expect(sql.evidence(mark).scalarCells).toBeGreaterThan(0);
    expect(sql.events(mark).every(event => /^\s*(?:\/\*[^]*?\*\/\s*)?SELECT\b/iu.test(event.sql))).toBe(true);
    expect(durableState()).toEqual(before);
    expect(world.checks).toEqual(calls); expect(world.finalities).toEqual(finalities);
    expect(failed.kind).toBe('threw');
  } finally { session.close(); cleanup(); store.remove(); }
});
