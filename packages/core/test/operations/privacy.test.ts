/**
 * Event privacy and port conformance of external operations on the real
 * packages (RUN-013; EXP-8 mechanism 7, resolution 7).
 *
 * Expected values come from the owner decision of 2026-09-30: events carry
 * identifiers, statuses, timings, usage figures and exact references only,
 * never input, output or argument values, request bindings, or provider
 * request or response bodies; diagnostics name fields and keys, not their
 * contents; usage units in events are validated identifiers.
 *
 * The planted value appears in every provider response, every provider error
 * message and every request binding (see `provider.ts` and `fixture.ts`), and
 * in the error an author's body throws under the `author-throws` plan. A
 * framework failure names the step and the failure kind only; the author's
 * error stays available to the caller as the failure's `cause`.
 *
 * The conformance test is type-level evidence in a non-published location:
 * History's operation journal port and Accounting's durable adapter satisfy
 * the structural ports Supervision owns, so the published Supervision
 * package takes no dependency on private Accounting.
 *
 * @see ../../../../docs/spec/operations.md (RUN-013 owner decision)
 * @see ../../../../docs/spec/package-boundaries.md (PKG-004, PKG-005)
 * @see ../../../../experiments/exp-8/decision.md (mechanism 7, resolution 7)
 * @see ../../../../docs/plans/m5-operations.md (planned evidence `event-privacy`)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import type { IDurableAccounting } from '@microdelta/accounting';
import type { IOperationJournal } from '@microdelta/history';
import { createStopController } from '@microdelta/supervision';
import type { IOperationAccounting, IOperationJournalPort, IOperationResponse } from '@microdelta/supervision';

import { ResolutionError } from '@microdelta/resolution';

import { childSecret, createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { fakeTimer, freshKey, openSession, statuses, tempStores, until } from './harness.js';
import type { IFakeTimer, IOperationStores } from './harness.js';
import { planted } from './provider.js';
import { driveUntilSettled, members, received } from './support.js';

let stores: IOperationStores;
let timer: IFakeTimer;
let world: IWorld;

beforeEach(() => {
  stores = tempStores();
  timer = fakeTimer();
  world = installWorld(createWorld(() => timer.currentEpochMilliseconds(), ['pr-1', 'pr-2', 'pr-3', 'pr-4', 'pr-5']));
});

afterEach(() => {
  stores.remove();
});

/** Whether any file beside the History store (History, Accounting, WAL and journal files) contains `text`. */
function storeContains(text: string): boolean {
  const directory = dirname(stores.history);
  return readdirSync(directory).some((name) => readFileSync(join(directory, name)).includes(text));
}

/** The innermost cause of a failure: the value author code threw, beneath every framework failure wrapping it. */
function rootCause(error: unknown): unknown {
  let current = error;
  while (current instanceof ResolutionError && current.cause !== undefined) {
    current = current.cause;
  }
  return current;
}

/** The planted marker's distinctive core, which any leak of a body, error message or binding contains. */
const marker = 'c0ffee';

describe('event privacy (RUN-013)', () => {
  test('no planted value reaches any event, diagnostic or member report across every outcome', async () => {
    world.provider.script('assess', 'pr-1', ['ok']);
    world.provider.script('assess', 'pr-2', ['lost']);
    world.provider.script('assess', 'pr-3', ['transient', 'ok']);
    world.options['pr-3'] = { retry: { maxAttempts: 2, backoffMilliseconds: 1_000 } };
    world.provider.script('assess', 'pr-4', ['permanent']);
    world.provider.script('assess', 'pr-5', ['rate-limit:60000', 'hang']);
    const session = openSession(stores, timer);
    try {
      const stop = createStopController();
      const started = members(session, { stop, permits: 5 });
      // Advance through pr-3's backoff and pr-5's deferral until pr-5's retry is in flight.
      for (let round = 0; round < 10 && !(received('pr-5').length === 2 && world.provider.inFlight === 1); round += 1) {
        await until(() => timer.pending().length > 0 || (received('pr-5').length === 2 && world.provider.inFlight === 1), 'the run waits or pr-5 is in flight');
        const next = [...timer.pending()].sort((left, right) => left - right)[0];
        if (next !== undefined && !(received('pr-5').length === 2 && world.provider.inFlight === 1)) {
          timer.advanceTo(next);
        }
      }
      expect(world.provider.inFlight).toBe(1);
      stop.request({ level: 'hard' });
      const result = await driveUntilSettled(timer, started);
      expect(planted).toContain(marker);
      expect(started.events.length).toBeGreaterThan(10);
      expect(JSON.stringify(started.events)).not.toContain(marker);
      expect(JSON.stringify(result.diagnostics)).not.toContain(marker);
      // Member reports name failures by identifiers only; their messages never carry provider text.
      const reported = result.value.members.map((member) => member.status === 'failed' ? member.error.message : member.status === 'pending' || member.status === 'cancelled' ? member.reason : member.status);
      expect(JSON.stringify(reported)).not.toContain(marker);
      expect((await session.start({}, (run) => run.inspectOperations()).done).value.length).toBe(5);
      expect(JSON.stringify((await session.start({}, (run) => run.inspectOperations()).done).value)).not.toContain(marker);
    } finally {
      session.close();
    }
  });

  test('an author error carrying the planted value reaches the caller only as the failure\'s cause: never its message, an event or a diagnostic', async () => {
    world.plans['pr-1'] = 'author-throws';
    const session = openSession(stores, timer);
    try {
      const started = members(session);
      const result = await started.done;
      const failed = result.value.members.find((member) => member.key === 'pr-1');
      if (failed?.status !== 'failed') {
        throw new Error(`expected pr-1 to fail, observed ${String(failed?.status)}`);
      }
      expect(failed.error.code).toBe('execution-failure');
      // The framework message names the failing step; the author's own error is its cause, unchanged.
      expect(failed.error.message).toContain('assess');
      expect(failed.error.message).not.toContain(marker);
      expect(failed.error.cause instanceof Error ? failed.error.cause.message : undefined).toBe(`author assessment of pr-1 rejected ${planted}`);
      expect(JSON.stringify(started.events)).not.toContain(marker);
      expect(JSON.stringify(result.diagnostics)).not.toContain(marker);
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'failed', 'pr-2': 'succeeded', 'pr-3': 'succeeded', 'pr-4': 'succeeded', 'pr-5': 'succeeded' });
    } finally {
      session.close();
    }
  });

  test('a declared child that fails with an author error fails its parent typed; neither its message, an event nor a stored record repeats the error', async () => {
    world.gates.open('parent');
    world.paidThrows = true;
    const session = openSession(stores, timer);
    try {
      const started = session.start({}, (run) => run.resolve(session.fixture.parent, freshKey()));
      const failure = await started.done.then(() => undefined, (error: unknown) => error);
      expect(failure).toBeInstanceOf(ResolutionError);
      expect(failure instanceof ResolutionError ? failure.code : undefined).toBe('execution-failure');
      // The framework message names the parent; the child's author error is reached only through the cause chain.
      expect(failure instanceof Error ? failure.message : '').toContain('parent');
      expect(failure instanceof Error ? failure.message : '').not.toContain(childSecret);
      const thrown = rootCause(failure);
      expect(thrown instanceof Error ? thrown.message : undefined).toBe(`paid assessment refused ${childSecret}`);
      expect(JSON.stringify(started.events)).not.toContain(childSecret);
    } finally {
      session.close();
    }
    // Both attempts ended failed, and neither ending record holds the author's text.
    expect(storeContains(childSecret)).toBe(false);
  });

  test('a usage unit that is not an identifier is dropped from the event and diagnosed by code, while Accounting keeps it', async () => {
    const session = openSession(stores, timer);
    try {
      world.keys = ['pr-1'];
      const original = world.provider;
      world.provider = {
        ...original,
        perform: async (name, key, send): Promise<IOperationResponse<{ readonly key: string; readonly verdict: string }>> => {
          const answer = await original.perform(name, key, send);
          return answer.kind === 'succeeded' ? { ...answer, usage: { report: 'r-1', quantities: [{ unit: 'tokens', amount: 7 }, { unit: 'Tokens.Cached', amount: 3 }] } } : answer;
        },
      };
      const started = members(session);
      const result = await started.done;
      const acknowledged = started.events.find((event) => event.kind === 'operation' && event.phase === 'usage-acknowledged');
      expect(acknowledged?.kind === 'operation' ? acknowledged.usage : undefined).toEqual([{ unit: 'tokens', amount: 7 }]);
      expect(result.diagnostics.filter((line) => line.includes('usage-unit-dropped'))).toHaveLength(1);
      expect(result.diagnostics.join('\n')).not.toContain('Tokens.Cached');
      expect(session.usage().observed).toEqual([{ unit: 'Tokens.Cached', amount: 3 }, { unit: 'tokens', amount: 7 }]);
    } finally {
      session.close();
    }
  });
});

describe('Supervision owns the ports History and Accounting satisfy', () => {
  test('History\'s operation journal and Accounting\'s durable adapter are assignable to Supervision\'s structural ports', () => {
    const session = openSession(stores, timer);
    try {
      // Type-level conformance: these assignments compile only if the owners satisfy the ports.
      const journal: IOperationJournalPort = session.journal;
      const accounting: IOperationAccounting = session.accounting;
      expect([journal, accounting]).toEqual([session.journal, session.accounting]);
      // A port lacking a method is not assignable.
      const incomplete: Pick<IOperationJournal, 'read' | 'list'> = session.journal;
      // @ts-expect-error: a journal port without `commit` cannot record an intent before a send.
      const refused: IOperationJournalPort = incomplete;
      const partial: Pick<IDurableAccounting, 'recordUsageIntent'> = session.accounting;
      // @ts-expect-error: an accounting port without `acknowledgeUsage` cannot acknowledge usage.
      const alsoRefused: IOperationAccounting = partial;
      expect([refused, alsoRefused]).toHaveLength(2);
    } finally {
      session.close();
    }
  });
});
