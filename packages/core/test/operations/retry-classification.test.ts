/**
 * Assembled source-classification outcomes across the real Supervision,
 * History and Accounting path. The source policy must make a complete local
 * decision over bounded facts while Supervision retains address, send and
 * usage authority (RUN-011/012/014/017; A-12d/i).
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { SupervisionError, createStopController, operationsCollection } from '@microdelta/supervision';
import type { IRetryDecisionInput, ISourceRetryPolicy } from '@microdelta/supervision';

import { analysis, createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { T0, fakeTimer, openSession, production, tempStores, until } from './harness.js';
import type { IFakeTimer, IOperationStores } from './harness.js';
import { driveUntilSettled, failureCode, journalContents, memberOf, members, received } from './support.js';
import { planted } from './provider.js';

let stores: IOperationStores;
let timer: IFakeTimer;
let world: IWorld;

beforeEach(() => {
  stores = tempStores();
  timer = fakeTimer();
  world = installWorld(createWorld(() => timer.currentEpochMilliseconds()));
});

afterEach(() => {
  stores.remove();
});

/** The exact adapter/service/access tuple used by the catalog response fixture. */
const catalogScope = { source: 'catalog', service: 'catalog-api', connection: 'org-a-read' } as const;

describe('durable source retry classification', () => {
  test('without source configuration the default sends at most three attempts after 2s and 4s', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['transient', 'transient', 'transient', 'ok']);
    const session = openSession(stores, timer);
    try {
      const started = members(session);
      await until(() => timer.pending().includes(T0 + 2_000), 'the first default backoff');
      expect(received('pr-1')).toHaveLength(1);
      timer.advanceTo(T0 + 2_000);
      await until(() => timer.pending().includes(T0 + 6_000), 'the second default backoff');
      expect(received('pr-1')).toHaveLength(2);
      timer.advanceTo(T0 + 6_000);
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
      expect(received('pr-1')).toHaveLength(3);
      expect(new Set(received('pr-1').map((request) => request.operation)).size).toBe(1);
      expect(timer.pending()).toEqual([]);
    } finally {
      session.close();
    }
  });

  test('a source policy sees only bounded extracted facts, while raw provider fields stay private', async () => {
    const rawSecret = 'RAW_RESPONSE_PRIVATE_SENTINEL';
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['permanent', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    const underlying = world.provider;
    world.provider = { ...underlying, async perform(name, key, send) {
      const response = await underlying.perform(name, key, send);
      return response.kind === 'failed'
        ? { ...response, body: rawSecret, url: `https://example.invalid/${rawSecret}`, headers: { authorization: rawSecret }, retryFacts: { httpStatus: 403, providerCode: 'secondary_rate_limit' } }
        : response;
    } };
    const inputs: IRetryDecisionInput[] = [];
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide(input) {
      inputs.push(input);
      return { kind: 'retry-now' };
    } };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { retryPolicies: [policy] });
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(inputs).toHaveLength(1);
      expect(inputs[0]?.facts).toEqual({ httpStatus: 403, providerCode: 'secondary_rate_limit' });
      expect(JSON.stringify(inputs)).not.toContain(planted);
      expect(JSON.stringify(inputs)).not.toContain(rawSecret);
      expect(JSON.stringify(started.events)).not.toContain(planted);
      expect(JSON.stringify(started.events)).not.toContain(rawSecret);
      expect(JSON.stringify(result.diagnostics)).not.toContain(planted);
      expect(JSON.stringify(result.diagnostics)).not.toContain(rawSecret);
      expect(JSON.stringify(journalContents(session))).not.toContain(rawSecret);
      expect(received('pr-1')).toHaveLength(2);
    } finally {
      session.close();
    }
  });

  test('duplicate registrations and throwing scope getters fail before any provider send', async () => {
    world.keys = ['pr-1'];
    world.options['pr-1'] = { retrySource: catalogScope };
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide: () => ({ kind: 'retry-now' }) };
    const throwing: ISourceRetryPolicy = {
      id: 'bad-policy',
      get scope(): typeof catalogScope { throw new Error('private getter secret'); },
      decide: () => ({ kind: 'retry-now' }),
    };
    const session = openSession(stores, timer);
    try {
      await expect(members(session, { retryPolicies: [policy, policy] }).done).rejects.toThrow(SupervisionError);
      await expect(members(session, { retryPolicies: [throwing] }).done).rejects.toThrow(SupervisionError);
      expect(received('pr-1')).toHaveLength(0);
      expect(journalContents(session)).toHaveLength(0);
    } finally {
      session.close();
    }
  });

  test('registration and request source mutations after capture cannot relabel the chosen response', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404']);
    const registeredScope: { source: string; service: string; connection: string } = { ...catalogScope };
    const requestScope: { source: string; service: string; connection: string } = { ...catalogScope };
    world.options['pr-1'] = { retrySource: requestScope };
    const seen: IRetryDecisionInput[] = [];
    let finish: (() => void) | undefined;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: registeredScope, decide(input) {
      seen.push(input);
      return new Promise((resolve) => { finish = () => { resolve({ kind: 'stop' }); }; });
    } };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { retryPolicies: [policy] });
      registeredScope.connection = 'changed-after-run-capture';
      await until(() => finish !== undefined, 'the chosen source policy starts');
      requestScope.connection = 'changed-after-request-capture';
      finish?.();
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('failed');
      expect(seen).toHaveLength(1);
      expect(seen[0]?.source).toEqual(catalogScope);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        sourceSelection: expect.objectContaining({ scope: catalogScope }),
        attempts: [expect.objectContaining({ source: catalogScope })],
      }));
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('an exact source callback overrides a contextual permanent refusal while another connection uses defaults', async () => {
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.provider.script('assess', 'pr-2', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    world.options['pr-2'] = { retrySource: { ...catalogScope, connection: 'org-b-read' } };
    const inputs: IRetryDecisionInput[] = [];
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide(input) {
      inputs.push(input);
      return { kind: 'retry-now' };
    } };
    const session = openSession(stores, timer);
    try {
      const result = await members(session, { retryPolicies: [policy] }).done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(memberOf(result.value, 'pr-2').status).not.toBe('succeeded');
      expect(received('pr-1')).toHaveLength(2);
      expect(received('pr-2')).toHaveLength(1);
      expect(inputs).toHaveLength(1);
      expect(inputs[0]).toEqual(expect.objectContaining({
        source: catalogScope,
        facts: { httpStatus: 404, conditions: ['resource-expected-later'] },
        outcome: { kind: 'failed', transient: false },
        history: expect.objectContaining({ sentAttempts: 1, prior: [], omittedPriorAttempts: 0 }),
      }));
    } finally {
      session.close();
    }
  });

  test.each([
    ['missing source', undefined],
    ['different adapter', { ...catalogScope, source: 'catalog-v2' }],
    ['different service', { ...catalogScope, service: 'catalog-admin' }],
    ['different connection', { ...catalogScope, connection: 'org-b-read' }],
  ] as const)('%s cannot borrow a registered retry policy', async (_label, retrySource) => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = retrySource === undefined ? {} : { retrySource };
    let calls = 0;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      calls += 1;
      return { kind: 'retry-now' };
    } };
    const session = openSession(stores, timer);
    try {
      const result = await members(session, { retryPolicies: [policy] }).done;
      expect(memberOf(result.value, 'pr-1').status).not.toBe('succeeded');
      expect(calls).toBe(0);
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('a delayed decision is retained at acceptance time and reused without a second callback', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let calls = 0;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      calls += 1;
      return { kind: 'retry-after', delayMilliseconds: 5_000 };
    } };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { retryPolicies: [policy] });
      await until(() => timer.pending().includes(timer.currentEpochMilliseconds() + 5_000), 'accepted custom deadline');
      const deadline = timer.currentEpochMilliseconds() + 5_000;
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        status: 'deferred', notBefore: deadline, previousDelayMilliseconds: 5_000,
        classification: expect.objectContaining({ kind: 'accepted', decision: { kind: 'retry-after', delayMilliseconds: 5_000 }, notBefore: deadline }),
      }));
      timer.advanceTo(deadline);
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(2);
      expect(calls).toBe(1);
    } finally {
      session.close();
    }
  });

  test('a new private run starts retry history without carrying the previous run delay', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'contextual-404', 'contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope, retry: { maxAttempts: 2 } };
    const seen: IRetryDecisionInput[] = [];
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide(input) {
      seen.push(input);
      return seen.length === 1 ? { kind: 'retry-after', delayMilliseconds: 5_000 } : { kind: 'retry-now' };
    } };
    const session = openSession(stores, timer);
    try {
      const first = await driveUntilSettled(timer, members(session, { runId: 'run:repeated-label', retryPolicies: [policy] }));
      expect(memberOf(first.value, 'pr-1').status).toBe('pending');
      expect(received('pr-1')).toHaveLength(2);
      expect(seen).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ previousDelayMilliseconds: 5_000 }));
      const second = await members(session, { runId: 'run:repeated-label', retryPolicies: [policy] }).done;
      expect(memberOf(second.value, 'pr-1').status).toBe('succeeded');
      expect(seen).toHaveLength(2);
      expect(seen.map((input) => input.context.runId)).toEqual(['run:repeated-label', 'run:repeated-label']);
      expect(seen[1]?.history).toEqual(expect.objectContaining({
        sentAttempts: 1,
        prior: [],
        omittedPriorAttempts: 0,
      }));
      expect(seen[1]?.history.previousDelayMilliseconds).toBeUndefined();
      expect(received('pr-1')).toHaveLength(4);
      expect(new Set(received('pr-1').map((request) => request.operation)).size).toBe(1);
    } finally {
      session.close();
    }
  });

  test('a later pass rejects a changed source tuple for the same operation and private run before send', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let calls = 0;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      calls += 1;
      return { kind: 'retry-after', delayMilliseconds: 5_000 };
    } };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { retryPolicies: [policy] });
      await until(() => timer.pending().some((at) => at >= timer.currentEpochMilliseconds() + 5_000), 'the accepted retry wait');
      const [first] = received('pr-1');
      world.options['pr-1'] = { retrySource: { ...catalogScope, connection: 'org-b-read' } };
      timer.advanceTo(timer.currentEpochMilliseconds() + 5_000);
      const result = await started.done;
      expect(received('pr-1')).toHaveLength(1);
      expect(calls).toBe(1);
      expect(memberOf(result.value, 'pr-1').status).not.toBe('succeeded');
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        operation: first?.operation,
        classification: expect.objectContaining({ kind: 'accepted', decision: { kind: 'retry-after', delayMilliseconds: 5_000 } }),
        attempts: [expect.objectContaining({ requestAttempt: first?.requestAttempt })],
      }));
    } finally {
      session.close();
    }
  });

  test('a fresh run may adopt a source for an unscoped retained request without losing its floor', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['rate-limit:5000', 'contextual-404', 'ok']);
    world.options['pr-1'] = { retry: { maxAttempts: 1 } };
    const seen: IRetryDecisionInput[] = [];
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide(input) {
      seen.push(input);
      return { kind: 'retry-now' };
    } };
    const session = openSession(stores, timer);
    try {
      await members(session).done;
      const first = received('pr-1')[0];
      expect(first).toBeDefined();
      const floor = timer.currentEpochMilliseconds() + 5_000;
      world.options['pr-1'] = { retrySource: catalogScope };
      const continuation = members(session, { retryPolicies: [policy] });
      await until(() => timer.pending().includes(floor), 'retained provider floor');
      expect(received('pr-1')).toHaveLength(1);
      timer.advanceTo(floor);
      const resumed = await continuation.done;
      expect(memberOf(resumed.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(3);
      expect(received('pr-1')[1]?.operation).toBe(first?.operation);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.history.sentAttempts).toBe(1);
      expect(seen[0]?.history.previousDelayMilliseconds).toBeUndefined();
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        operation: first?.operation,
        attempts: [expect.objectContaining({ requestAttempt: first?.requestAttempt }), expect.any(Object), expect.any(Object)],
      }));
    } finally {
      session.close();
    }
  });

  test('a different connection with a distinct intended binding owns another operation and history', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    const original: ISourceRetryPolicy = { id: 'original', scope: catalogScope, decide: () => ({ kind: 'stop' }) };
    const secondScope = { ...catalogScope, connection: 'org-b-read' };
    const seen: IRetryDecisionInput[] = [];
    const revised: ISourceRetryPolicy = { id: 'revised', scope: secondScope, decide(input) {
      seen.push(input);
      return { kind: 'retry-now' };
    } };
    const session = openSession(stores, timer);
    try {
      const first = await members(session, { retryPolicies: [original] }).done;
      expect(memberOf(first.value, 'pr-1').status).toBe('failed');
      const originalRequest = received('pr-1')[0];
      expect(originalRequest).toBeDefined();

      world.bindingSuffix = ':org-b-intended-request';
      world.options['pr-1'] = { retrySource: secondScope };
      const second = await members(session, { retryPolicies: [revised] }).done;
      expect(memberOf(second.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(3);
      expect(received('pr-1')[1]?.operation).not.toBe(originalRequest?.operation);
      expect(received('pr-1')[2]?.operation).toBe(received('pr-1')[1]?.operation);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.history.sentAttempts).toBe(1);
      expect(seen[0]?.history.prior).toEqual([]);
      expect(seen[0]?.history.previousDelayMilliseconds).toBeUndefined();
    } finally {
      session.close();
    }
  });

  test('a different environment owns a separate operation and no production retry history', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    const seen: IRetryDecisionInput[] = [];
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide(input) {
      seen.push(input);
      return input.context.environment === production ? { kind: 'stop' } : { kind: 'retry-now' };
    } };
    const session = openSession(stores, timer);
    try {
      await members(session, { retryPolicies: [policy], environment: production }).done;
      const productionRequest = received('pr-1')[0];
      expect(productionRequest).toBeDefined();
      const trialResult = await members(session, { retryPolicies: [policy], environment: 'env:trial' }).done;
      expect(memberOf(trialResult.value, 'pr-1').status).toBe('succeeded');
      const trialRequests = received('pr-1').slice(1);
      expect(trialRequests).toHaveLength(2);
      expect(trialRequests[0]?.operation).not.toBe(productionRequest?.operation);
      expect(trialRequests[1]?.operation).toBe(trialRequests[0]?.operation);
      expect(seen.map((input) => input.context.environment)).toEqual([production, 'env:trial']);
      expect(seen[1]?.history).toEqual(expect.objectContaining({ sentAttempts: 1, prior: [], omittedPriorAttempts: 0 }));
    } finally {
      session.close();
    }
  });

  test('a different analysis owns a separate operation and no prior classifier history', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    const firstPolicy: ISourceRetryPolicy = { id: 'original', scope: catalogScope, decide: () => ({ kind: 'stop' }) };
    const firstSession = openSession(stores, timer);
    try {
      const first = await members(firstSession, { retryPolicies: [firstPolicy] }).done;
      expect(memberOf(first.value, 'pr-1').status).toBe('failed');
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      firstSession.close();
    }
    const seen: IRetryDecisionInput[] = [];
    const secondPolicy: ISourceRetryPolicy = { id: 'other-analysis', scope: catalogScope, decide(input) {
      seen.push(input);
      return { kind: 'retry-now' };
    } };
    const secondSession = openSession(stores, timer, { analysis: 'ops:other-analysis' });
    try {
      const second = await members(secondSession, { retryPolicies: [secondPolicy] }).done;
      expect(memberOf(second.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(3);
      expect(received('pr-1')[1]?.operation).not.toBe(received('pr-1')[0]?.operation);
      expect(received('pr-1')[2]?.operation).toBe(received('pr-1')[1]?.operation);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.context.analysis).toBe('ops:other-analysis');
      expect(seen[0]?.history.prior).toEqual([]);
      expect(seen[0]?.history.sentAttempts).toBe(1);
    } finally {
      secondSession.close();
    }
  });

  test('policy throw remains bounded and an explicit new run retains identity and usage', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let calls = 0;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      calls += 1;
      throw new Error('private callback secret');
    } };
    const session = openSession(stores, timer);
    try {
      const first = await members(session, { retryPolicies: [policy] }).done;
      expect(failureCode(memberOf(first.value, 'pr-1'))).toBe('operation-classification-failed');
      expect(calls).toBe(1);
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        classification: expect.objectContaining({ kind: 'failed', code: 'policy-error' }),
        attempts: [expect.objectContaining({ status: 'failed', usage: 'acknowledged' })],
      }));
      const second = await members(session, { retryPolicies: [policy] }).done;
      expect(memberOf(second.value, 'pr-1').status).toBe('succeeded');
      expect(calls).toBe(1);
      const requests = received('pr-1');
      expect(requests).toHaveLength(2);
      expect(requests[1]?.operation).toBe(requests[0]?.operation);
      expect(requests[1]?.requestAttempt).not.toBe(requests[0]?.requestAttempt);
      expect(JSON.stringify(journalContents(session))).not.toContain('private callback secret');
    } finally {
      session.close();
    }
  });

  test.each([
    { decision: 'failed', expectedCode: 'operation-classification-failed' },
    { decision: 'stop', expectedCode: 'operation-failed' },
  ] as const)('same-run re-entry retains a $decision classification and its original address', async ({ decision, expectedCode }) => {
    world.keys = ['pr-1'];
    world.plans['pr-1'] = 'catch-retry';
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let calls = 0;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      calls += 1;
      if (decision === 'failed') {
        throw new Error('private classification detail');
      }
      return { kind: 'stop' };
    } };
    const session = openSession(stores, timer);
    try {
      await members(session, { retryPolicies: [policy] }).done;
      expect(world.log.filter((entry) => entry.startsWith('caught:pr-1:'))).toEqual(Array.from({ length: 3 }, () => `caught:pr-1:${expectedCode}`));
      expect(calls).toBe(1);
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        operation: received('pr-1')[0]?.operation,
        classification: expect.objectContaining({ kind: decision === 'failed' ? 'failed' : 'accepted' }),
        attempts: [expect.objectContaining({ requestAttempt: received('pr-1')[0]?.requestAttempt, status: 'failed', usage: 'acknowledged' })],
      }));
    } finally {
      session.close();
    }
  });

  test('a rejected decision commit leaves the known response pending and a new run preserves its evidence', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let calls = 0;
    let decisionFailures = 0;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      calls += 1;
      return { kind: 'retry-now' };
    } };
    const session = openSession(stores, timer, { wrapJournal: (journal) => ({
      ...journal,
      commit(lease, request) {
        const accepting = request.writes.some((write) => {
          if (write.collection !== operationsCollection || typeof write.record.content !== 'object' || write.record.content === null) {
            return false;
          }
          const classification: unknown = Reflect.get(write.record.content, 'classification');
          return typeof classification === 'object' && classification !== null && Reflect.get(classification, 'kind') === 'accepted';
        });
        if (accepting && decisionFailures === 0) {
          decisionFailures += 1;
          throw new Error('simulated decision commit refusal');
        }
        return journal.commit(lease, request);
      },
    }) });
    try {
      const first = await members(session, { retryPolicies: [policy] }).done;
      expect(memberOf(first.value, 'pr-1').status).toBe('pending');
      expect(decisionFailures).toBe(1);
      expect(calls).toBe(1);
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        status: 'pending', classification: expect.objectContaining({ kind: 'pending', facts: { httpStatus: 404, conditions: ['resource-expected-later'] } }),
        attempts: [expect.objectContaining({ status: 'failed', usage: 'acknowledged' })],
      }));
      const second = await members(session, { retryPolicies: [policy] }).done;
      expect(memberOf(second.value, 'pr-1').status).toBe('succeeded');
      expect(calls).toBe(1);
      const requests = received('pr-1');
      expect(requests).toHaveLength(2);
      expect(requests[1]?.operation).toBe(requests[0]?.operation);
      expect(requests[1]?.requestAttempt).not.toBe(requests[0]?.requestAttempt);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        status: 'succeeded',
        attempts: [
          expect.objectContaining({ status: 'failed', usage: 'acknowledged', facts: { httpStatus: 404, conditions: ['resource-expected-later'] } }),
          expect.objectContaining({ status: 'succeeded', usage: 'acknowledged' }),
        ],
      }));
    } finally {
      session.close();
    }
  });

  test('a crash before the response commit remains an unknown send and cannot invoke source policy', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let calls = 0;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      calls += 1;
      return { kind: 'retry-now' };
    } };
    let refuseResponse = true;
    const session = openSession(stores, timer, { wrapJournal: (journal) => ({
      ...journal,
      commit(lease, request) {
        const recordsResponse = request.writes.some((write) => {
          if (write.collection !== operationsCollection || typeof write.record.content !== 'object' || write.record.content === null) {
            return false;
          }
          const classification: unknown = Reflect.get(write.record.content, 'classification');
          return typeof classification === 'object' && classification !== null && Reflect.get(classification, 'kind') === 'pending';
        });
        if (recordsResponse && refuseResponse) {
          refuseResponse = false;
          throw new Error('simulated pre-response crash');
        }
        return journal.commit(lease, request);
      },
    }) });
    try {
      const first = await members(session, { retryPolicies: [policy] }).done;
      expect(memberOf(first.value, 'pr-1').status).toBe('pending');
      expect(calls).toBe(0);
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        status: 'pending',
        classification: null,
        attempts: [expect.objectContaining({ status: 'pending' })],
      }));
      const second = await members(session, { retryPolicies: [policy] }).done;
      expect(memberOf(second.value, 'pr-1').status).toBe('succeeded');
      expect(calls).toBe(0);
      const requests = received('pr-1');
      expect(requests).toHaveLength(2);
      expect(requests[1]?.operation).toBe(requests[0]?.operation);
      expect(requests[1]?.requestAttempt).not.toBe(requests[0]?.requestAttempt);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        attempts: [expect.objectContaining({ status: 'unknown' }), expect.objectContaining({ status: 'succeeded' })],
      }));
    } finally {
      session.close();
    }
  });

  test('a fresh run recovering a known pending response cannot send before its retained provider floor', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    const underlying = world.provider;
    const providerFloor = T0 + 10_000;
    world.provider = { ...underlying, async perform(name, key, send) {
      const response = await underlying.perform(name, key, send);
      return response.kind === 'failed' ? { ...response, notBefore: providerFloor } : response;
    } };
    world.options['pr-1'] = { retrySource: catalogScope };
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide: () => ({ kind: 'retry-now' }) };
    let refuseDecision = true;
    const session = openSession(stores, timer, { wrapJournal: (journal) => ({
      ...journal,
      commit(lease, request) {
        const accepts = request.writes.some((write) => write.collection === operationsCollection
          && typeof write.record.content === 'object' && write.record.content !== null
          && Reflect.get(Reflect.get(write.record.content, 'classification') ?? {}, 'kind') === 'accepted');
        if (accepts && refuseDecision) {
          refuseDecision = false;
          throw new Error('simulated decision commit refusal');
        }
        return journal.commit(lease, request);
      },
    }) });
    try {
      await members(session, { retryPolicies: [policy] }).done;
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ status: 'pending', notBefore: providerFloor }));
      const resumed = members(session, { retryPolicies: [policy] });
      let finished = false;
      void resumed.done.then(() => { finished = true; }, () => { finished = true; });
      await until(() => timer.pending().includes(providerFloor) || received('pr-1').length > 1 || finished, 'the retained provider floor is considered');
      expect(received('pr-1')).toHaveLength(1);
      timer.advanceTo(providerFloor - 1);
      expect(received('pr-1')).toHaveLength(1);
      timer.advanceTo(providerFloor);
      const result = await resumed.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(2);
    } finally {
      session.close();
    }
  });

  test('an answer from an expired writer cannot publish or alter a newer run', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let resolveFirst: ((decision: { readonly kind: 'retry-now' }) => void) | undefined;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      return new Promise((resolve) => { resolveFirst = resolve; });
    } };
    const firstSession = openSession(stores, timer, { leaseMilliseconds: 1_000 });
    let secondSession: ReturnType<typeof openSession> | undefined;
    try {
      const first = members(firstSession, { retryPolicies: [policy] });
      await until(() => resolveFirst !== undefined, 'the first writer waits for classification');
      expect(journalContents(firstSession)).toContainEqual(expect.objectContaining({ classification: expect.objectContaining({ kind: 'pending' }) }));
      const firstSettlements = first.events.filter((event) => event.kind === 'operation' && event.phase === 'request-settled').length;
      timer.advanceTo(T0 + 1_001);
      secondSession = openSession(stores, timer);
      const second = await members(secondSession, { retryPolicies: [policy] }).done;
      expect(memberOf(second.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(2);
      const committed = JSON.stringify(journalContents(secondSession));
      const accounted = JSON.stringify(secondSession.usage());
      resolveFirst?.({ kind: 'retry-now' });
      await first.done;
      expect(first.events.filter((event) => event.kind === 'operation' && event.phase === 'request-settled')).toHaveLength(firstSettlements);
      expect(JSON.stringify(journalContents(secondSession))).toBe(committed);
      expect(JSON.stringify(secondSession.usage())).toBe(accounted);
      expect(received('pr-1')).toHaveLength(2);
    } finally {
      secondSession?.close();
      firstSession.close();
    }
  });

  test('a same-fence revision supersession discards the old policy answer without a later write or event', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let resolveDecision: ((decision: { readonly kind: 'retry-now' }) => void) | undefined;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      return new Promise((resolve) => { resolveDecision = resolve; });
    } };
    let liveLease: { readonly holder: string; readonly fence: number; readonly expiresAt: number } | undefined;
    const session = openSession(stores, timer, { wrapJournal: (journal) => ({
      ...journal,
      commit(lease, request) {
        const result = journal.commit(lease, request);
        if (request.writes.some((write) => write.collection === operationsCollection
          && typeof write.record.content === 'object' && write.record.content !== null
          && Reflect.get(Reflect.get(write.record.content, 'classification') ?? {}, 'kind') === 'pending')) {
          liveLease = lease;
        }
        return result;
      },
    }) });
    try {
      const started = members(session, { retryPolicies: [policy] });
      await until(() => resolveDecision !== undefined, 'the policy waits on its persisted generation');
      const request = received('pr-1')[0];
      const lease = liveLease;
      if (request === undefined || lease === undefined) {
        throw new Error('the response did not commit under a live writer');
      }
      const address = { analysis, environment: production, collection: operationsCollection, key: request.operation };
      const pending = session.journal.read(address);
      if (pending === undefined) {
        throw new Error('the pending response has no journal entry');
      }
      // An independent same-fence writer increments the revision without
      // changing the response. Revision alone revokes the waiting answer.
      session.journal.commit(lease, { analysis, environment: production, writes: [{
        collection: operationsCollection, key: request.operation, expectedRevision: pending.revision, record: pending.record,
      }] });
      const operationsBefore = JSON.stringify(session.journal.list({ analysis, environment: production, collection: operationsCollection }));
      const usageBefore = JSON.stringify(session.usage());
      const eventsBefore = JSON.stringify(started.events.filter((event) => event.kind === 'operation'));
      resolveDecision?.({ kind: 'retry-now' });
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
      expect(JSON.stringify(session.journal.list({ analysis, environment: production, collection: operationsCollection }))).toBe(operationsBefore);
      expect(JSON.stringify(session.usage())).toBe(usageBefore);
      expect(JSON.stringify(started.events.filter((event) => event.kind === 'operation'))).toBe(eventsBefore);
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('same-run re-entry observes one live policy wait without another callback or send', async () => {
    world.keys = ['pr-1'];
    world.plans['pr-1'] = 'concurrent';
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let resolveDecision: ((decision: { readonly kind: 'stop' }) => void) | undefined;
    let calls = 0;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      calls += 1;
      return new Promise((resolve) => { resolveDecision = resolve; });
    } };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { retryPolicies: [policy] });
      await until(() => resolveDecision !== undefined, 'the live policy wait');
      world.gates.open('pr-1:second');
      await until(() => world.log.some((entry) => entry.startsWith('pr-1:second:')), 'the re-entry observes the wait');
      expect(world.log).toContain('pr-1:second:operation-classification-incomplete');
      expect(JSON.stringify(started.events)).toContain('classification-waiting');
      expect(calls).toBe(1);
      expect(received('pr-1')).toHaveLength(1);
      resolveDecision?.({ kind: 'stop' });
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).not.toBe('succeeded');
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('a failed decision commit is interrupted on same-run re-entry, not a second policy wait', async () => {
    world.keys = ['pr-1'];
    world.plans['pr-1'] = 'catch-retry';
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let calls = 0;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      calls += 1;
      return { kind: 'retry-now' };
    } };
    let refuseDecision = true;
    const session = openSession(stores, timer, { wrapJournal: (journal) => ({
      ...journal,
      commit(lease, request) {
        const accepts = request.writes.some((write) => write.collection === operationsCollection
          && typeof write.record.content === 'object' && write.record.content !== null
          && Reflect.get(Reflect.get(write.record.content, 'classification') ?? {}, 'kind') === 'accepted');
        if (accepts && refuseDecision) {
          refuseDecision = false;
          throw new Error('simulated decision commit refusal');
        }
        return journal.commit(lease, request);
      },
    }) });
    try {
      const started = members(session, { retryPolicies: [policy] });
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).not.toBe('succeeded');
      expect(calls).toBe(1);
      expect(received('pr-1')).toHaveLength(1);
      // The first refused decision and both author-level retries report the
      // same incomplete known classification without invoking policy again.
      expect(world.log.filter((entry) => entry === 'caught:pr-1:operation-classification-incomplete')).toHaveLength(3);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ classification: expect.objectContaining({ kind: 'pending' }) }));
    } finally {
      session.close();
    }
  });

  test('a soft stop cancels an asynchronous decision and a late answer cannot send', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    const stop = createStopController();
    let resolveDecision: ((decision: { readonly kind: 'retry-now' }) => void) | undefined;
    let signalAborted = false;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide(input) {
      input.signal.onAbort(() => { signalAborted = true; });
      return new Promise((resolve) => { resolveDecision = resolve; });
    } };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { retryPolicies: [policy], stop });
      await until(() => resolveDecision !== undefined, 'the classifier starts');
      stop.request({ level: 'soft' });
      await started.done;
      expect(signalAborted).toBe(true);
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ classification: expect.objectContaining({ kind: 'cancelled' }) }));
      const before = JSON.stringify(journalContents(session));
      resolveDecision?.({ kind: 'retry-now' });
      await Promise.resolve();
      expect(JSON.stringify(journalContents(session))).toBe(before);
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('a hard stop detaches a policy wait and handles a late rejection without another write', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    const stop = createStopController();
    let rejectDecision: ((reason: Error) => void) | undefined;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      return new Promise((_resolve, reject) => { rejectDecision = reject; });
    } };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { retryPolicies: [policy], stop });
      await until(() => rejectDecision !== undefined, 'the policy waits');
      stop.request({ level: 'hard' });
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).not.toBe('succeeded');
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ classification: expect.objectContaining({ kind: 'cancelled' }) }));
      const before = JSON.stringify(journalContents(session));
      rejectDecision?.(new Error('private late rejection'));
      await Promise.resolve();
      expect(JSON.stringify(journalContents(session))).toBe(before);
      expect(received('pr-1')).toHaveLength(1);
      expect(result.diagnostics.join(' ')).not.toContain('private late rejection');
    } finally {
      session.close();
    }
  });

  test('an operator deadline ends the classifier wait and a later answer cannot revive it', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    const stop = createStopController({ timer });
    let resolveDecision: ((decision: { readonly kind: 'retry-now' }) => void) | undefined;
    let signalAborted = false;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide(input) {
      input.signal.onAbort(() => { signalAborted = true; });
      return new Promise((resolve) => { resolveDecision = resolve; });
    } };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { retryPolicies: [policy], stop });
      await until(() => resolveDecision !== undefined, 'the policy waits for a decision');
      stop.request({ level: 'soft', deadline: T0 + 1_000 });
      timer.advanceTo(T0 + 1_000);
      const result = await started.done;
      expect(result.stop).toEqual({ level: 'hard', cause: 'deadline', deadline: undefined });
      expect(signalAborted).toBe(true);
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ classification: expect.objectContaining({ kind: 'cancelled' }) }));
      const before = JSON.stringify(journalContents(session));
      resolveDecision?.({ kind: 'retry-now' });
      await Promise.resolve();
      expect(JSON.stringify(journalContents(session))).toBe(before);
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('a policy callback has no live author operation capability', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    const session = openSession(stores, timer);
    let nestedSends = 0;
    let nestedCode: string | undefined;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, async decide() {
      try {
        await session.supervision.execution().operation({
          name: 'nested', binding: 'sha256:nested',
          perform: () => { nestedSends += 1; return Promise.resolve({ kind: 'succeeded', value: 1 }); },
        });
      } catch (error: unknown) {
        nestedCode = error instanceof SupervisionError ? error.code : undefined;
      }
      return { kind: 'retry-now' };
    } };
    try {
      const result = await members(session, { retryPolicies: [policy] }).done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(nestedSends).toBe(0);
      expect(nestedCode).toBe('invalid-request');
      expect(received('pr-1')).toHaveLength(2);
    } finally {
      session.close();
    }
  });

  test('a waiting classifier holds no send permit and lets an unrelated member finish', async () => {
    world.keys = ['pr-1', 'pr-2'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.provider.script('assess', 'pr-2', ['ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let resolveDecision: ((decision: { readonly kind: 'stop' }) => void) | undefined;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      return new Promise((resolve) => { resolveDecision = resolve; });
    } };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { retryPolicies: [policy], permits: 1 });
      await until(() => resolveDecision !== undefined, 'the source classifier waits');
      await until(() => received('pr-2').length === 1, 'the unrelated member sends while classification waits');
      expect(received('pr-1')).toHaveLength(1);
      expect(received('pr-2')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        classification: expect.objectContaining({ kind: 'pending' }),
        attempts: [expect.objectContaining({ status: 'failed' })],
      }));
      resolveDecision?.({ kind: 'stop' });
      const result = await started.done;
      expect(memberOf(result.value, 'pr-2').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('a hostile decision getter fails classification without falling through to a default retry', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      return { get kind(): 'retry-now' { throw new Error('private decision getter'); } };
    } };
    const session = openSession(stores, timer);
    try {
      const result = await members(session, { retryPolicies: [policy] }).done;
      expect(failureCode(memberOf(result.value, 'pr-1'))).toBe('operation-classification-failed');
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        classification: expect.objectContaining({ kind: 'failed', code: 'policy-error' }),
        attempts: [expect.objectContaining({ status: 'failed', usage: 'acknowledged' })],
      }));
      expect(result.diagnostics.join(' ')).not.toContain('private decision getter');
    } finally {
      session.close();
    }
  });

  test.each([
    ['missing choice', undefined],
    ['no-opinion choice', { kind: 'no-opinion' }],
    ['attempt grant', { kind: 'retry-now', maxAttempts: 99 }],
    ['zero delayed duration', { kind: 'retry-after', delayMilliseconds: 0 }],
    ['negative delayed duration', { kind: 'retry-after', delayMilliseconds: -1 }],
    ['fractional duration', { kind: 'retry-after', delayMilliseconds: 1.5 }],
    ['NaN delayed duration', { kind: 'retry-after', delayMilliseconds: Number.NaN }],
    ['infinite delayed duration', { kind: 'retry-after', delayMilliseconds: Number.POSITIVE_INFINITY }],
    ['unsafe duration', { kind: 'retry-after', delayMilliseconds: Number.MAX_SAFE_INTEGER + 1 }],
    ['acceptance-time overflow', { kind: 'retry-after', delayMilliseconds: Number.MAX_SAFE_INTEGER }],
  ] as const)('invalid policy result %s fails without a fallback send', async (_label, answer) => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide: () => ({ kind: 'stop' }) };
    // Deliberately emulate an untyped JavaScript policy; tsd separately rejects these results.
    Reflect.set(policy, 'decide', () => Promise.resolve(answer));
    const session = openSession(stores, timer);
    try {
      const result = await members(session, { retryPolicies: [policy] }).done;
      expect(failureCode(memberOf(result.value, 'pr-1'))).toBe('operation-classification-failed');
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        classification: expect.objectContaining({ kind: 'failed', code: 'policy-error' }),
        attempts: [expect.objectContaining({ status: 'failed', usage: 'acknowledged' })],
      }));
    } finally {
      session.close();
    }
  });

  test('a decision delay begins at acceptance and remains behind the stronger provider floor', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['rate-limit:10000', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let resolveDecision: ((decision: { readonly kind: 'retry-after'; readonly delayMilliseconds: number }) => void) | undefined;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      return new Promise((resolve) => { resolveDecision = resolve; });
    } };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { retryPolicies: [policy] });
      await until(() => resolveDecision !== undefined, 'the timed classifier starts');
      const acceptedAt = timer.currentEpochMilliseconds() + 3_000;
      timer.advanceTo(acceptedAt);
      resolveDecision?.({ kind: 'retry-after', delayMilliseconds: 5_000 });
      await until(() => journalContents(session).some((entry) => typeof entry === 'object' && entry !== null && Reflect.get(entry, 'status') === 'deferred'), 'the decision commits');
      const floor = acceptedAt + 7_000;
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        notBefore: floor,
        classification: expect.objectContaining({ kind: 'accepted', delayMilliseconds: 5_000, notBefore: floor }),
      }));
      timer.advanceTo(floor - 1);
      expect(received('pr-1')).toHaveLength(1);
      timer.advanceTo(floor);
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(2);
    } finally {
      session.close();
    }
  });

  test.each([
    { label: 'fixed default with response notBefore above retryAt', retryAtDelay: 3_000, notBeforeDelay: 8_000, custom: false, effectiveDelay: 8_000 },
    { label: 'custom immediate with retryAt above response notBefore', retryAtDelay: 10_000, notBeforeDelay: 8_000, custom: true, effectiveDelay: 10_000 },
  ])('$label honors the maximum known response floor', async ({ retryAtDelay, notBeforeDelay, custom, effectiveDelay }) => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', [`rate-limit:${retryAtDelay}`, 'ok']);
    world.options['pr-1'] = { retry: { backoffMilliseconds: 6_000 }, ...(custom ? { retrySource: catalogScope } : {}) };
    const underlying = world.provider;
    world.provider = { ...underlying, async perform(name, key, send) {
      const answer = await underlying.perform(name, key, send);
      return answer.kind === 'rate-limited' ? { ...answer, notBefore: T0 + notBeforeDelay } : answer;
    } };
    let calls = 0;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      calls += 1;
      return { kind: 'retry-now' };
    } };
    const session = openSession(stores, timer);
    try {
      const started = members(session, custom ? { retryPolicies: [policy] } : {});
      const floor = T0 + effectiveDelay;
      await until(() => timer.pending().includes(floor), 'the strongest response floor');
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ status: 'deferred', notBefore: floor }));
      expect(calls).toBe(custom ? 1 : 0);
      timer.advanceTo(floor - 1);
      expect(received('pr-1')).toHaveLength(1);
      timer.advanceTo(floor);
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(2);
    } finally {
      session.close();
    }
  });

  test('persists the response and address as pending before a single async policy wait', async () => {
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let resolveDecision: ((decision: { readonly kind: 'retry-now' }) => void) | undefined;
    const entered: IRetryDecisionInput[] = [];
    const policy: ISourceRetryPolicy = {
      id: 'catalog-policy',
      scope: catalogScope,
      decide(input) {
        entered.push(input);
        return new Promise((resolve) => { resolveDecision = resolve; });
      },
    };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { retryPolicies: [policy] });
      let settled = false;
      void started.done.then(() => { settled = true; }, () => { settled = true; });
      await until(() => entered.length > 0 || settled, 'the classifier starts or the run settles');
      expect(entered).toHaveLength(1);
      const [record] = journalContents(session).filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null);
      expect(record).toEqual(expect.objectContaining({
        status: 'pending',
        classification: expect.objectContaining({ kind: 'pending' }),
        attempts: [expect.objectContaining({ status: 'failed', usage: 'acknowledged' })],
      }));
      resolveDecision?.({ kind: 'retry-now' });
      const result = await driveUntilSettled(timer, started);
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(2);
      expect(new Set(received('pr-1').map((request) => request.operation)).size).toBe(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        classification: expect.objectContaining({ kind: 'accepted', decision: { kind: 'retry-now' } }),
        attempts: [expect.objectContaining({ status: 'failed', decision: { kind: 'retry-now' } }), expect.objectContaining({ status: 'succeeded' })],
      }));
      expect(result.diagnostics.join(' ')).not.toContain('lease-lost');
    } finally {
      session.close();
    }
  });

  test('retry-now records a decision but waits behind the independent total allowance', async () => {
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope, retry: { maxAttempts: 1 } };
    let calls = 0;
    const policy: ISourceRetryPolicy = {
      id: 'catalog-policy',
      scope: catalogScope,
      decide: () => {
        calls += 1;
        return { kind: 'retry-now' };
      },
    };
    const session = openSession(stores, timer);
    try {
      const result = await members(session, { retryPolicies: [policy] }).done;
      expect(calls).toBe(0);
      expect(received('pr-1')).toHaveLength(1);
      expect(memberOf(result.value, 'pr-1').status).not.toBe('succeeded');
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        status: 'retry-exhausted',
        classification: expect.objectContaining({ kind: 'no-retry', code: 'policy-exhausted' }),
      }));
    } finally {
      session.close();
    }
  });

  test('an accepted source stop remains address-owning and never becomes acquired input', async () => {
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    const policy: ISourceRetryPolicy = {
      id: 'catalog-policy',
      scope: catalogScope,
      decide: () => ({ kind: 'stop' }),
    };
    const session = openSession(stores, timer);
    try {
      const result = await members(session, { retryPolicies: [policy] }).done;
      expect(received('pr-1')).toHaveLength(1);
      expect(memberOf(result.value, 'pr-1').status).not.toBe('succeeded');
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        status: 'retry-exhausted',
        classification: expect.objectContaining({ kind: 'accepted', decision: { kind: 'stop' } }),
      }));
    } finally {
      session.close();
    }
  });

  test('a callback failure is retained without default fallthrough or a second send', async () => {
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let calls = 0;
    const policy: ISourceRetryPolicy = {
      id: 'catalog-policy',
      scope: catalogScope,
      decide: () => {
        calls += 1;
        throw new Error('private policy detail');
      },
    };
    const session = openSession(stores, timer);
    try {
      const result = await members(session, { retryPolicies: [policy] }).done;
      expect(calls).toBe(1);
      expect(received('pr-1')).toHaveLength(1);
      expect(memberOf(result.value, 'pr-1').status).not.toBe('succeeded');
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        status: 'retry-exhausted',
        classification: expect.objectContaining({ kind: 'failed', code: 'policy-error' }),
      }));
      expect(JSON.stringify(journalContents(session))).not.toContain('private policy detail');
    } finally {
      session.close();
    }
  });

  test('an asynchronously rejected decision retains a typed failure and the known refusal', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    let calls = 0;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, async decide() {
      calls += 1;
      await Promise.resolve();
      throw new Error('private async policy detail');
    } };
    const session = openSession(stores, timer);
    try {
      const result = await members(session, { retryPolicies: [policy] }).done;
      expect(failureCode(memberOf(result.value, 'pr-1'))).toBe('operation-classification-failed');
      expect(calls).toBe(1);
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        classification: expect.objectContaining({ kind: 'failed', code: 'policy-error' }),
        attempts: [expect.objectContaining({ status: 'failed', usage: 'acknowledged',
          outcome: { kind: 'failed', transient: false }, facts: { httpStatus: 404, conditions: ['resource-expected-later'] } })],
      }));
      expect(JSON.stringify(journalContents(session))).not.toContain('private async policy detail');
    } finally {
      session.close();
    }
  });

  test('malformed adapter retry facts cannot reach a policy or authorize another send', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    const underlying = world.provider;
    world.provider = { ...underlying, async perform(name, key, send) {
      const answer = await underlying.perform(name, key, send);
      return answer.kind === 'failed' ? { ...answer, retryFacts: { httpStatus: Number.NaN } } : answer;
    } };
    let calls = 0;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      calls += 1;
      return { kind: 'retry-now' };
    } };
    const session = openSession(stores, timer);
    try {
      const result = await members(session, { retryPolicies: [policy] }).done;
      expect(failureCode(memberOf(result.value, 'pr-1'))).toBe('invalid-request');
      expect(calls).toBe(0);
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        status: 'pending', attempts: [expect.objectContaining({ status: 'pending' })],
      }));
      expect(session.usage().unknown).toEqual(expect.arrayContaining([expect.objectContaining({
        operation: received('pr-1')[0]?.operation, requestAttempt: received('pr-1')[0]?.requestAttempt,
      })]));
    } finally {
      session.close();
    }
  });

  test.each([
    { response: 'rate-limit', custom: false, subcap: 1 },
    { response: 'rate-limit:3000', custom: false, subcap: 1 },
    { response: 'rate-limit', custom: true, subcap: 1 },
    { response: 'rate-limit:3000', custom: true, subcap: 1 },
    { response: 'rate-limit', custom: false, subcap: 0 },
    { response: 'rate-limit:3000', custom: false, subcap: 0 },
    { response: 'rate-limit', custom: true, subcap: 0 },
    { response: 'rate-limit:3000', custom: true, subcap: 0 },
  ] as const)('the restrictive rate subcap $subcap applies to $response with custom=$custom', async ({ response, custom, subcap }) => {
    world.keys = ['pr-1'];
    world.options['pr-1'] = { retry: { maxAttempts: 5, rateLimitRetries: subcap }, ...(custom ? { retrySource: catalogScope } : {}) };
    world.provider.script('assess', 'pr-1', [response, response, 'ok']);
    let calls = 0;
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide() {
      calls += 1;
      return { kind: 'retry-now' };
    } };
    const session = openSession(stores, timer);
    try {
      const result = await driveUntilSettled(timer, members(session, custom ? { retryPolicies: [policy] } : {}));
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
      expect(received('pr-1')).toHaveLength(subcap + 1);
      expect(calls).toBe(custom ? subcap : 0);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ status: 'retry-exhausted' }));
    } finally {
      session.close();
    }
  });

  test('rate-like facts and a provider floor cannot turn a normalized transient failure into a rate refusal', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['transient', 'ok']);
    world.options['pr-1'] = { retry: { rateLimitRetries: 0 } };
    const underlying = world.provider;
    const floor = T0 + 5_000;
    world.provider = { ...underlying, async perform(name, key, send) {
      const response = await underlying.perform(name, key, send);
      return response.kind === 'failed'
        ? { ...response, retryFacts: { httpStatus: 429, providerCode: 'secondary_rate_limit' }, notBefore: floor }
        : response;
    } };
    const session = openSession(stores, timer);
    try {
      const started = members(session);
      await until(() => timer.pending().includes(floor), 'the failed response retains its independent floor');
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        notBefore: floor,
        attempts: [expect.objectContaining({ status: 'failed', facts: { httpStatus: 429, providerCode: 'secondary_rate_limit' } })],
      }));
      timer.advanceTo(floor);
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(2);
    } finally {
      session.close();
    }
  });

  test.each([
    { label: 'unchanged authentication', response: 'permanent', status: 401, code: 'bad_credentials', expectedSends: 1, category: 'failed' },
    { label: 'bad request', response: 'permanent', status: 400, code: 'invalid_request', expectedSends: 1, category: 'failed' },
    { label: 'confirmed absence', response: 'permanent', status: 404, code: 'confirmed_absence', expectedSends: 1, category: 'failed' },
    { label: 'contextual rate restriction', response: 'rate-limit:3000', status: 403, code: 'secondary_rate_limit', expectedSends: 2, category: 'rate-limited' },
    { label: 'temporary contention', response: 'transient', status: 409, code: 'temporary_contention', expectedSends: 2, category: 'failed' },
    { label: 'unchanged revision conflict', response: 'permanent', status: 409, code: 'invalid_revision', expectedSends: 1, category: 'failed' },
  ] as const)('$label follows adapter normalization, not its HTTP status alone', async ({ response, status, code, expectedSends, category }) => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', [response, 'ok']);
    const underlying = world.provider;
    world.provider = { ...underlying, async perform(name, key, send) {
      const answer = await underlying.perform(name, key, send);
      return answer.kind === 'failed' || answer.kind === 'rate-limited'
        ? { ...answer, retryFacts: { httpStatus: status, providerCode: code } }
        : answer;
    } };
    const session = openSession(stores, timer);
    try {
      const result = await driveUntilSettled(timer, members(session));
      expect(received('pr-1')).toHaveLength(expectedSends);
      expect(memberOf(result.value, 'pr-1').status === 'succeeded').toBe(expectedSends === 2);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        attempts: expect.arrayContaining([expect.objectContaining({
          status: category,
          facts: { httpStatus: status, providerCode: code },
        })]),
      }));
    } finally {
      session.close();
    }
  });

  test('the callback sees only the latest eight prior sends and an authoritative current-run tally', async () => {
    world.keys = ['pr-1'];
    world.options['pr-1'] = { retrySource: catalogScope, retry: { maxAttempts: 11, backoffMilliseconds: 0 } };
    world.provider.script('assess', 'pr-1', [...Array.from({ length: 10 }, (): 'transient' => 'transient'), 'ok']);
    const seen: IRetryDecisionInput[] = [];
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide(input) {
      seen.push(input);
      return { kind: 'retry-now' };
    } };
    const session = openSession(stores, timer);
    try {
      const result = await members(session, { retryPolicies: [policy] }).done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(11);
      expect(seen).toHaveLength(10);
      expect(seen[9]?.history).toEqual(expect.objectContaining({
        sentAttempts: 10, omittedPriorAttempts: 1,
        prior: expect.arrayContaining([expect.objectContaining({ status: 'failed', usage: 'acknowledged' })]),
      }));
      expect(seen[9]?.history.prior).toHaveLength(8);
      expect(seen[9]?.history.prior.map((attempt) => attempt.requestAttempt)).toEqual(received('pr-1').slice(1, 9).map((attempt) => attempt.requestAttempt));
      expect(seen[9]?.history.prior.every((attempt) => attempt.decision?.kind === 'retry-now')).toBe(true);
    } finally {
      session.close();
    }
  });

  test('callback history keeps unknown usage and excludes another operation', async () => {
    world.keys = ['pr-1', 'pr-2'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'contextual-404', 'ok']);
    world.provider.script('assess', 'pr-2', ['contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    world.options['pr-2'] = { retrySource: catalogScope };
    const underlying = world.provider;
    let omitted = false;
    world.provider = { ...underlying, async perform(name, key, send) {
      const answer = await underlying.perform(name, key, send);
      if (key === 'pr-1' && !omitted && answer.kind === 'failed') {
        omitted = true;
        const unreported = { ...answer };
        delete unreported.usage;
        return unreported;
      }
      return answer;
    } };
    const seen: IRetryDecisionInput[] = [];
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide(input) {
      seen.push(input);
      return { kind: 'retry-now' };
    } };
    const session = openSession(stores, timer);
    try {
      const result = await members(session, { retryPolicies: [policy] }).done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(memberOf(result.value, 'pr-2').status).toBe('succeeded');
      const first = received('pr-1')[0];
      const other = received('pr-2')[0];
      const ownInputs = seen.filter((input) => input.operation === first?.operation);
      expect(ownInputs).toHaveLength(2);
      expect(ownInputs[1]?.history).toEqual(expect.objectContaining({
        sentAttempts: 2,
        omittedPriorAttempts: 0,
        prior: [expect.objectContaining({ requestAttempt: first?.requestAttempt, status: 'failed', usage: 'none' })],
      }));
      expect(ownInputs[1]?.history.prior.some((attempt) => attempt.requestAttempt === other?.requestAttempt)).toBe(false);
      expect(session.usage().unknown).toEqual(expect.arrayContaining([expect.objectContaining({
        operation: first?.operation, requestAttempt: first?.requestAttempt,
      })]));
    } finally {
      session.close();
    }
  });

  test('a source policy can grow its delay from the prior accepted decision', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['contextual-404', 'contextual-404', 'ok']);
    world.options['pr-1'] = { retrySource: catalogScope };
    const priorDelays: (number | undefined)[] = [];
    const policy: ISourceRetryPolicy = { id: 'catalog-policy', scope: catalogScope, decide(input) {
      const prior = input.history.previousDelayMilliseconds;
      priorDelays.push(prior);
      return { kind: 'retry-after', delayMilliseconds: prior === undefined ? 2_000 : Math.ceil(prior * 1.7) };
    } };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { retryPolicies: [policy] });
      await until(() => timer.pending().includes(T0 + 2_000), 'the first source backoff');
      expect(received('pr-1')).toHaveLength(1);
      timer.advanceTo(T0 + 2_000);
      await until(() => timer.pending().includes(T0 + 5_400), 'the grown source backoff');
      expect(received('pr-1')).toHaveLength(2);
      timer.advanceTo(T0 + 5_400);
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(priorDelays).toEqual([undefined, 2_000]);
      expect(received('pr-1')).toHaveLength(3);
      expect(new Set(received('pr-1').map((request) => request.operation)).size).toBe(1);
    } finally {
      session.close();
    }
  });
});
