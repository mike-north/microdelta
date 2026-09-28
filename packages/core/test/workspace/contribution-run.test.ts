/**
 * The contributor report through the facade's workspace run path: authoring
 * builders, Run Supervision, Reuse Resolution over durable History (Node's
 * real SQLite), Tracking and Materialization. Expected statistics and
 * sentences are written by hand from the M3 plan's fixture decisions, not
 * captured from program output.
 *
 * - Ada: PRs 101, 102 merged, 103 open, five submitted reviews:
 *   authored 3, merged 2, reviews 5.
 * - Ben: PR 201 merged, 202 open, three submitted reviews:
 *   authored 2, merged 1, reviews 3.
 *
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Concrete fixture decisions, worked walkthrough)
 * @see ../../../../docs/spec/acceptance.md (TEST-2, A-02, A-03)
 * @see ../../../../docs/spec/composition.md (CMP-6)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { adaActivity, resetWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { assemblies, locatorOf, openSession, recorder, runReport, tempStore } from './support.js';
import type { ITempStore } from './support.js';

/** Ada's expected summary (plan: authored 3, merged 2, reviews 5). */
const adaSummary = {
  key: 'person:ada',
  name: 'Ada',
  authored: 3,
  merged: 2,
  reviews: 5,
  sentence: 'Ada authored 3 pull requests, 2 of which were merged, and submitted 5 reviews.',
};

/** Ben's expected summary (plan: authored 2, merged 1, reviews 3; singular "was merged"). */
const benSummary = {
  key: 'person:ben',
  name: 'Ben',
  authored: 2,
  merged: 1,
  reviews: 3,
  sentence: 'Ben authored 2 pull requests, 1 of which was merged, and submitted 3 reviews.',
};

let store: ITempStore;
let world: IWorld;

beforeEach(() => {
  store = tempStore();
  world = resetWorld();
  assemblies.count = 0;
});

afterEach(() => {
  store.remove();
});

describe('contribution report through the workspace run path', () => {
  test('TEST-2: a cold run executes each source and summary once and assembles the key-ordered report once', async () => {
    const session = openSession(store.location);
    const events = recorder();
    try {
      const { outcomes, report, run } = await runReport(session, { observers: [events] });
      expect(outcomes['person:ada'].kind).toBe('published');
      expect(outcomes['person:ben'].kind).toBe('published');
      expect(report).toEqual({
        repository: 'acme/widget',
        window: { start: '2026-01-01', end: '2026-04-01' },
        contributors: [adaSummary, benSummary],
      });
      expect(world.checks).toEqual({ 'person:ada': 1, 'person:ben': 1 });
      expect(world.summaries).toEqual({ 'person:ada': 1, 'person:ben': 1 });
      expect(events.executions('person:ada', 'activity')).toBe(1);
      expect(events.executions('person:ada', 'summary')).toBe(1);
      expect(events.executions('person:ben', 'summary')).toBe(1);
      expect(events.ordinary('report')).toEqual(['begin', 'end']);
      expect(assemblies.count).toBe(1);
      expect(run.diagnostics).toEqual([]);
    } finally {
      session.close();
    }
  });

  test('A-02/CMP-6: a restarted process resolving members in reverse reuses both exact summaries without bodies', async () => {
    const cold = openSession(store.location);
    let coldRefs: Record<string, string>;
    try {
      const { outcomes } = await runReport(cold);
      coldRefs = { ada: locatorOf(outcomes['person:ada']), ben: locatorOf(outcomes['person:ben']) };
    } finally {
      cold.close();
    }
    world = resetWorld();
    const restarted = openSession(store.location, { order: 'ben-first' });
    const events = recorder();
    try {
      const { outcomes, report } = await runReport(restarted, { order: ['person:ben', 'person:ada'], observers: [events] });
      expect(outcomes['person:ada']).toMatchObject({ kind: 'reused', basis: 'validated' });
      expect(outcomes['person:ben']).toMatchObject({ kind: 'reused', basis: 'validated' });
      expect(locatorOf(outcomes['person:ada'])).toBe(coldRefs.ada);
      expect(locatorOf(outcomes['person:ben'])).toBe(coldRefs.ben);
      expect(world.summaries).toEqual({ 'person:ada': 0, 'person:ben': 0 });
      // Current source acceptance is still established in the new process.
      expect(world.finalities).toEqual({ 'person:ada': 1, 'person:ben': 1 });
      expect(world.checks).toEqual({ 'person:ada': 0, 'person:ben': 0 });
      expect(events.executions('person:ada', 'summary') + events.executions('person:ben', 'summary')).toBe(0);
      // Ordinary assembly runs again and orders by stable key, not resolution order.
      expect(report.contributors).toEqual([adaSummary, benSummary]);
      expect(assemblies.count).toBe(2);
    } finally {
      restarted.close();
    }
  });

  test('A-02/CMP-9: changing only unread avatar, labels and a then data field keeps both exact summaries', async () => {
    const cold = openSession(store.location);
    let coldAda: string;
    try {
      const { outcomes } = await runReport(cold);
      coldAda = locatorOf(outcomes['person:ada']);
    } finally {
      cold.close();
    }
    world = resetWorld();
    world.final['person:ada'] = false;
    world.remote['person:ada'] = adaActivity({ avatar: 'https://avatars.example/ada-2.png', label: 'enhancement', then: 'not a thenable' });
    const session = openSession(store.location);
    const events = recorder();
    try {
      const { outcomes, report } = await runReport(session, { observers: [events] });
      // The source check ran and published fresh data; the summary's consumed facts are equal.
      expect(world.checks['person:ada']).toBe(1);
      expect(events.phases('person:ada', 'activity')).toContain('publish');
      expect(outcomes['person:ada']).toMatchObject({ kind: 'reused', basis: 'validated' });
      expect(locatorOf(outcomes['person:ada'])).toBe(coldAda);
      expect(world.summaries['person:ada']).toBe(0);
      expect(report.contributors[0]).toEqual(adaSummary);
    } finally {
      session.close();
    }
  });

  test('A-02: a consumed merged-status change reevaluates only that member while the other keeps its exact result', async () => {
    const cold = openSession(store.location);
    let coldRefs: Record<string, string>;
    try {
      const { outcomes } = await runReport(cold);
      coldRefs = { ada: locatorOf(outcomes['person:ada']), ben: locatorOf(outcomes['person:ben']) };
    } finally {
      cold.close();
    }
    world = resetWorld();
    world.final['person:ada'] = false;
    world.remote['person:ada'] = adaActivity({ merged103: true });
    const session = openSession(store.location);
    try {
      const { outcomes, report } = await runReport(session);
      expect(outcomes['person:ada'].kind).toBe('published');
      expect(locatorOf(outcomes['person:ada'])).not.toBe(coldRefs.ada);
      expect(outcomes['person:ben']).toMatchObject({ kind: 'reused' });
      expect(locatorOf(outcomes['person:ben'])).toBe(coldRefs.ben);
      expect(world.summaries).toEqual({ 'person:ada': 1, 'person:ben': 0 });
      // Hand-derived: PR 103 now merged, so 3 of 3 were merged.
      expect(report.contributors).toEqual([
        { ...adaSummary, merged: 3, sentence: 'Ada authored 3 pull requests, 3 of which were merged, and submitted 5 reviews.' },
        benSummary,
      ]);
    } finally {
      session.close();
    }
  });

  test('A-03: an explicitly retaining source check keeps its exact reference and the summary reuses', async () => {
    const cold = openSession(store.location);
    try {
      await runReport(cold);
    } finally {
      cold.close();
    }
    world = resetWorld();
    world.final['person:ben'] = false;
    world.check['person:ben'] = 'retain';
    const session = openSession(store.location);
    const events = recorder();
    try {
      const { outcomes } = await runReport(session, { observers: [events] });
      expect(world.checks['person:ben']).toBe(1);
      expect(events.phases('person:ben', 'activity')).toEqual(['verify', 'finality', 'admit', 'claim', 'execute', 'accept', 'release']);
      expect(outcomes['person:ben']).toMatchObject({ kind: 'reused', basis: 'validated' });
      expect(world.summaries['person:ben']).toBe(0);
    } finally {
      session.close();
    }
  });
});
