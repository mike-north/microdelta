/** Finite provider deduplication is not an indefinite safety promise (RUN-012). */
import { describe, expect, test } from '@jest/globals';
import type { IOperationResponse, IOperationSend } from '@microdelta/supervision';
import { createWorld, installWorld } from './operations/fixture.js';
import { T0, fakeTimer, hour, openSession, statuses, tempStores } from './operations/harness.js';
import { journalContents, memberOf, members } from './operations/support.js';
import type { IAssessment, IFakeProvider, ILedgerEntry } from './operations/provider.js';

/** A deterministic provider promise ends at expiresAt, including the exact boundary. */
interface IApplied { readonly key: string; readonly expiresAt: number }
interface IFiniteProvider {
  /** Actual remote effects, separately observable from attempts to send. */
  readonly effects: readonly IApplied[];
  /** Commit only when the same key no longer has a live deduplication record. */
  send(key: string): boolean;
}
/** Provider-owned TTL is deliberately not a Supervision clock policy or durable safety declaration. */
function finiteProvider(now: () => number, ttl: number): IFiniteProvider {
  const effects: IApplied[] = [];
  return {
    effects,
    send(key): boolean {
      if (effects.some(effect => effect.key === key && now() < effect.expiresAt)) { return false; }
      effects.push({ key, expiresAt: now() + ttl });
      return true;
    },
  };
}

/**
 * Adapter sends stable operation identity as the provider key even though its
 * finite/uncertain horizon cannot authorize automatic retries. Every response is
 * lost after commit: returning unknown must not assert the effect did not happen.
 */
function lostResponseAdapter(remote: IFiniteProvider): IFakeProvider {
  const ledger: ILedgerEntry[] = [];
  return {
    ledger: () => ledger,
    script(): void { throw new Error('This adapter always loses its committed response'); },
    release(): void { throw new Error('This adapter does not hang'); },
    inFlight: 0,
    peak: 1,
    perform(name: string, key: string, send: IOperationSend): Promise<IOperationResponse<IAssessment>> {
      const identity = { name, key, operation: send.operation, requestAttempt: send.requestAttempt, idempotencyKey: send.operation };
      ledger.push({ kind: 'received', ...identity });
      if (remote.send(send.operation)) { ledger.push({ kind: 'applied', ...identity }); }
      return Promise.resolve({ kind: 'unknown' });
    },
  };
}

describe('gap hunt RUN-012 expired provider deduplication', () => {
  test('finite provider suppresses same-key effects before expiry but applies a direct replay at expiry', () => {
    const timer = fakeTimer();
    const remote = finiteProvider(() => timer.currentEpochMilliseconds(), hour);
    expect(remote.send('same-operation')).toBe(true);
    timer.advanceTo(T0 + hour - 1);
    expect(remote.send('same-operation')).toBe(false);
    timer.advanceTo(T0 + hour);
    expect(remote.send('same-operation')).toBe(true);
    expect(remote.effects).toEqual([{ key: 'same-operation', expiresAt: T0 + hour }, { key: 'same-operation', expiresAt: T0 + 2 * hour }]);
  });

  test('withholding a finite-horizon safety promise preserves unknown and prevents resend after durable session reopen beyond expiry', async () => {
    const stores = tempStores();
    const timer = fakeTimer();
    const remote = finiteProvider(() => timer.currentEpochMilliseconds(), hour);
    const adapter = lostResponseAdapter(remote);
    const world = createWorld(() => timer.currentEpochMilliseconds());
    world.keys = ['pr-1'];
    world.provider = adapter;
    // No safeToRepeat declaration. Keys alone cannot authorize replay when their retention horizon is uncertain.
    world.options['pr-1'] = { providerIdempotency: false, retry: { maxAttempts: 3 } };
    installWorld(world);
    try {
      const first = openSession(stores, timer);
      let operation: string | undefined;
      try {
        const result = await members(first).done;
        expect(statuses(result.value.members)).toEqual({ 'pr-1': 'pending' });
        operation = adapter.ledger()[0]?.operation;
        expect(operation).toEqual(expect.any(String));
        const member = memberOf(result.value, 'pr-1');
        expect(member.status === 'pending' ? member.blocked : undefined).toEqual({ kind: 'unknown-outcome', operation, reason: 'not-repeat-safe' });
        expect(journalContents(first)).toContainEqual(expect.objectContaining({ operation, status: 'unknown' }));
        expect(first.usage().unknown.map(entry => entry.operation)).toEqual([operation]);
        expect(adapter.ledger().filter(entry => entry.kind === 'received')).toHaveLength(1);
        expect(remote.effects).toHaveLength(1);
      } finally { first.close(); }
      timer.advanceTo(T0 + 2 * hour);
      const reopened = openSession(stores, timer);
      try {
        const result = await members(reopened).done;
        expect(statuses(result.value.members)).toEqual({ 'pr-1': 'pending' });
        const member = memberOf(result.value, 'pr-1');
        expect(member.status === 'pending' ? member.blocked : undefined).toEqual({ kind: 'unknown-outcome', operation, reason: 'not-repeat-safe' });
        expect(journalContents(reopened)).toContainEqual(expect.objectContaining({ operation, status: 'unknown' }));
        expect(reopened.usage().unknown.map(entry => entry.operation)).toEqual([operation]);
        expect(adapter.ledger().filter(entry => entry.kind === 'received')).toHaveLength(1);
        expect(remote.effects).toHaveLength(1);
      } finally { reopened.close(); }
    } finally { stores.remove(); }
  });
});
