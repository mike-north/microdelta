/**
 * A keyed request shares only the immutable complete input preparation.
 * Exact public Value snapshot bytes isolate full-input fingerprint work from
 * attempt and intent hashes, while the injected Tracking port counts complete
 * author input wrappers. Real member outcomes remain the behavior under test.
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { encodeSnapshot } from '@microdelta/value';

import { cleanup, freshLocation } from '../durable-history/support.js';
import { defaultConfig } from './fixture.js';
import { freshRequestKey, openSession, payloadOf } from './support.js';

afterEach(cleanup);

describe('request-local complete input preparation', () => {
  test('one measured derivation bounds real cold keyed fanout at multiple cardinalities', async () => {
    for (const cardinality of [1, 3]) {
      const config = { ...defaultConfig, keyedMembers: Array.from({ length: cardinality }, (_, index) => ({ key: `person:${index}` })) };
      const requestInputEncoding = encodeSnapshot({ config });
      const baselineHashes: string[] = [];
      const baselineViews: number[] = [];
      const baselineSession = openSession(freshLocation(), { keyed: true, config }, {}, {
        sha256Inputs: baselineHashes,
        inputTrackingBindings: baselineViews,
      });
      let oneDerivationBaseline: number;
      try {
        const baseline = await baselineSession.resolve(baselineSession.contributors.steps['person:ada'].activity, freshRequestKey());
        expect(baseline.kind).toBe('published');
        oneDerivationBaseline = baselineHashes.filter((input) => input === requestInputEncoding).length;
        expect(oneDerivationBaseline).toBeGreaterThan(0);
        expect(baselineViews).toHaveLength(1);
      } finally {
        baselineSession.close();
      }

      const sha256Inputs: string[] = [];
      const authorInputs: number[] = [];
      const session = openSession(freshLocation(), { keyed: true, config }, {}, {
        sha256Inputs,
        inputTrackingBindings: authorInputs,
      });
      try {
        const result = await session.resolveMembers('contributor', 'summary', freshRequestKey());
        expect(result.discovery.kind).toBe('keyed');
        expect(result.members).toHaveLength(cardinality);
        expect(result.members.map((member) => member.key)).toEqual(config.keyedMembers?.map((member) => member.key));
        expect(result.members.every((member) => member.outcome.kind === 'published')).toBe(true);
        const payloads = result.members.map(({ outcome }) => {
          if (outcome.kind !== 'published') {
            throw new Error(`expected each keyed body to publish, got ${outcome.kind}`);
          }
          return payloadOf(session.history, outcome.reference.locator);
        });
        expect(payloads).toEqual(Array.from({ length: cardinality }, () => ({ value: 'summary' })));

        const completeInputHashes = sha256Inputs.filter((input) => input === requestInputEncoding).length;
        expect(completeInputHashes).toBeLessThanOrEqual(oneDerivationBaseline);
        expect(completeInputHashes).toBeGreaterThan(0);
        expect(authorInputs.length).toBeLessThanOrEqual(1);
        expect(authorInputs.length).toBeGreaterThan(0);

        // A fresh top-level request owns fresh lazy preparations, even when the same composition is reused.
        const beforeFreshRequestHashes = completeInputHashes;
        const beforeFreshRequestViews = authorInputs.length;
        const freshResult = await session.resolveMembers('contributor', 'summary', freshRequestKey());
        expect(freshResult.members).toHaveLength(cardinality);
        expect(freshResult.members.map((member) => member.key)).toEqual(config.keyedMembers?.map((member) => member.key));
        expect(freshResult.members.every((member) => member.outcome.kind === 'published')).toBe(true);
        const freshRequestHashes = sha256Inputs.filter((input) => input === requestInputEncoding).length - beforeFreshRequestHashes;
        const freshRequestViews = authorInputs.length - beforeFreshRequestViews;
        expect(freshRequestHashes).toBeGreaterThan(0);
        expect(freshRequestHashes).toBeLessThanOrEqual(oneDerivationBaseline);
        expect(freshRequestViews).toBe(1);
      } finally {
        session.close();
      }
    }
  });

  test('an additional real Tracking and Value derivation exceeds the same measured bound', async () => {
    const expectedFullInputEncoding = encodeSnapshot({ config: defaultConfig });
    const sha256Inputs: string[] = [];
    const session = openSession(freshLocation(), {}, {}, { sha256Inputs });
    try {
      const baseline = await session.resolve(session.contributors.steps['person:ada'].activity, freshRequestKey());
      expect(baseline.kind).toBe('published');
      const oneDerivationBaseline = sha256Inputs.filter((input) => input === expectedFullInputEncoding).length;
      expect(oneDerivationBaseline).toBeGreaterThan(0);

      sha256Inputs.length = 0;
      const first = await session.resolve(session.contributors.steps['person:ben'].activity, freshRequestKey());
      expect(first.kind).toBe('published');
      const requestWork = sha256Inputs.filter((input) => input === expectedFullInputEncoding).length;
      expect(requestWork).toBe(oneDerivationBaseline);

      session.deriveFullInputFact();
      const workWithAdditionalDerivation = sha256Inputs.filter((input) => input === expectedFullInputEncoding).length;
      expect(workWithAdditionalDerivation).toBeGreaterThan(oneDerivationBaseline);
      expect(workWithAdditionalDerivation <= oneDerivationBaseline).toBe(false);
    } finally {
      session.close();
    }
  });

  test('construction and cold check stay lazy, while overlapping top-level requests remain independent', async () => {
    const expectedFullInputEncoding = encodeSnapshot({ config: defaultConfig });
    const baselineHashes: string[] = [];
    const baselineSession = openSession(freshLocation(), {}, {}, { sha256Inputs: baselineHashes });
    let oneDerivationBaseline: number;
    try {
      const baseline = await baselineSession.resolve(baselineSession.contributors.steps['person:ada'].activity, freshRequestKey());
      expect(baseline.kind).toBe('published');
      oneDerivationBaseline = baselineHashes.filter((input) => input === expectedFullInputEncoding).length;
      expect(oneDerivationBaseline).toBeGreaterThan(0);
    } finally {
      baselineSession.close();
    }

    const sha256Inputs: string[] = [];
    const authorInputs: number[] = [];
    const session = openSession(freshLocation(), {}, {}, { sha256Inputs, inputTrackingBindings: authorInputs });
    try {
      expect(sha256Inputs).toHaveLength(0);
      expect(authorInputs).toHaveLength(0);
      const check = await session.resolution.check({ step: session.contributors.steps['person:ada'].summary });
      expect(check.kind).toBe('execution-required');
      expect(sha256Inputs).toHaveLength(0);
      expect(authorInputs).toHaveLength(0);

      const [ada, ben] = await Promise.all([
        session.resolve(session.contributors.steps['person:ada'].activity, freshRequestKey()),
        session.resolve(session.contributors.steps['person:ben'].activity, freshRequestKey()),
      ]);
      expect(ada.kind).toBe('published');
      expect(ben.kind).toBe('published');
      expect(sha256Inputs.filter((input) => input === expectedFullInputEncoding)).toHaveLength(oneDerivationBaseline * 2);
      expect(authorInputs).toHaveLength(2);
    } finally {
      session.close();
    }
  });

  test('direct recovery derives current complete intent without preparing the author input view', async () => {
    const expectedFullInputEncoding = encodeSnapshot({ config: defaultConfig });
    const sha256Inputs: string[] = [];
    const authorInputs: number[] = [];
    const session = openSession(freshLocation(), {}, {}, { sha256Inputs, inputTrackingBindings: authorInputs });
    const requestKey = freshRequestKey();
    try {
      const published = await session.resolve(session.contributors.steps['person:ada'].activity, requestKey);
      expect(published.kind).toBe('published');
      expect(authorInputs).toHaveLength(1);

      sha256Inputs.length = 0;
      authorInputs.length = 0;
      const admissionsBeforeRecovery = session.admissions.length;
      const recovered = session.resolution.recover({ step: session.contributors.steps['person:ada'].activity, requestKey });

      expect(recovered.kind).toBe('recovered');
      expect(authorInputs).toHaveLength(0);
      expect(sha256Inputs.filter((input) => input === expectedFullInputEncoding).length).toBeGreaterThan(0);
      expect(session.admissions).toHaveLength(admissionsBeforeRecovery);
    } finally {
      session.close();
    }
  });

  test('recovery rejects a saved key whose unread declared input changed', async () => {
    const location = freshLocation();
    const requestKey = freshRequestKey();
    const first = openSession(location);
    try {
      expect((await first.resolve(first.contributors.steps['person:ada'].activity, requestKey)).kind).toBe('published');
    } finally {
      first.close();
    }

    const changed = openSession(location, { config: { ...defaultConfig, window: { ...defaultConfig.window, end: '2026-05-01' } } });
    try {
      await expect(Promise.resolve().then(() => changed.resolution.recover({ step: changed.contributors.steps['person:ada'].activity, requestKey })))
        .rejects.toMatchObject({ code: 'wrong-intent' });
      expect(changed.admissions).toHaveLength(0);
    } finally {
      changed.close();
    }
  });

  test('a delegated author-view preparation failure allocates nothing and does not poison a later request', async () => {
    const preparationFailure = new Error('injected delegated input-view failure');
    const failInputTracking = { error: preparationFailure, active: true };
    const authorInputs: number[] = [];
    const session = openSession(freshLocation(), {}, {}, { inputTrackingBindings: authorInputs, failInputTracking });
    try {
      const failed = session.sqlite.mark();
      await expect(session.resolve(session.contributors.steps['person:ada'].activity, freshRequestKey())).rejects.toBe(preparationFailure);
      expect(session.admissions).toHaveLength(0);
      expect(session.sqlite.evidence(failed).roles.allocate).toBeUndefined();

      failInputTracking.active = false;
      expect((await session.resolve(session.contributors.steps['person:ada'].activity, freshRequestKey())).kind).toBe('published');
      expect(authorInputs).toHaveLength(2);
    } finally {
      session.close();
    }
  });

  test('a complete-input SHA failure allocates nothing and does not poison a later request', async () => {
    const expectedFullInputEncoding = encodeSnapshot({ config: defaultConfig });
    const hashFailure = new Error('injected complete-input hash failure');
    const failSha256Input = { input: expectedFullInputEncoding, error: hashFailure, active: true };
    const authorInputs: number[] = [];
    const session = openSession(freshLocation(), {}, {}, { inputTrackingBindings: authorInputs, failSha256Input });
    try {
      const failed = session.sqlite.mark();
      await expect(session.resolve(session.contributors.steps['person:ada'].activity, freshRequestKey())).rejects.toBe(hashFailure);
      expect(session.admissions).toHaveLength(0);
      expect(session.sqlite.evidence(failed).roles.allocate).toBeUndefined();

      failSha256Input.active = false;
      expect((await session.resolve(session.contributors.steps['person:ada'].activity, freshRequestKey())).kind).toBe('published');
      expect(authorInputs).toHaveLength(2);
    } finally {
      session.close();
    }
  });

});
