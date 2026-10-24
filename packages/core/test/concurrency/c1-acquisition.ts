/**
 * Settle C1's initial losing acquisitions after its shared barrier has finished.
 * Storage contention is a nondecision, not ownership evidence: only a later
 * exact held observation lets the fencing scenario proceed. This test-only
 * helper neither selects a winner nor supplies a production acquisition policy.
 * @packageDocumentation
 */
import type { IWriterContention, IWriterLease } from '@microdelta/history';

import { isRecord, parseReply, stringField } from './protocol.js';
import type { IHarnessCommand } from './protocol.js';

/** The exact controlled-time acquisition C1 sent at its initial barrier. @internal */
export type IC1AcquireRequest = Extract<IHarnessCommand, { readonly op: 'acquire' }>;

/** Only the worker surface C1 needs; replies remain untrusted IPC values. @internal */
export interface IC1LoserWorker {
  readonly name: string;
  step(request: IC1AcquireRequest): Promise<unknown>;
}

/** An actual observed holder, never inferred from a contention diagnostic. */
interface IC1Held {
  readonly holder: string;
  readonly expiresAt: number;
}

/** Settled ownership plus prior nondecisions, which confer no authority. @internal */
export interface IC1LoserSettlement {
  readonly held: IC1Held;
  readonly contentions: readonly IWriterContention[];
}

/**
 * Bound the fixture's re-observations independently of production busy timing.
 * Each command also retains the driver's existing command timeout; exhausting
 * this count fails the scenario rather than silently dropping a contender.
 */
const maximumReobservations = 3;

/** Stored fences and times must survive JSON without fractional or unsafe values. */
function integerField(record: Readonly<Record<string, unknown>>, key: string, minimum: number): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`C1 expected a safe integer ${key} at least ${String(minimum)}`);
  }
  return value;
}

/** Writer identities are nonempty; diagnostic identity need not be current. */
function holderField(record: Readonly<Record<string, unknown>>): string {
  const holder = stringField(record, 'holder');
  if (holder.length === 0) { throw new TypeError('C1 expected a nonempty holder'); }
  return holder;
}

/** Parse only the typed nondecision; an absent or historical writer is valid. */
function contentionFrom(value: Readonly<Record<string, unknown>>): IWriterContention {
  const detail = stringField(value, 'detail');
  let writer: IWriterLease | undefined;
  if (value.writer !== undefined) {
    if (!isRecord(value.writer)) { throw new TypeError('C1 contention writer must be a lease snapshot or absent'); }
    writer = {
      holder: holderField(value.writer),
      fence: integerField(value.writer, 'fence', 1),
      expiresAt: integerField(value.writer, 'expiresAt', 0),
    };
  }
  return { kind: 'contended', detail, writer };
}

/**
 * Require an initial loser to observe the already established C1 winner.
 * Retry only validated contended values, keeping the identical command and
 * logical clock. An additional grant, wrong holder, malformed value, failed
 * reply or thrown worker failure ends the test; none is retryable here.
 * @internal
 */
export async function settleC1Loser(worker: IC1LoserWorker, request: IC1AcquireRequest, initial: unknown, winner: IWriterLease): Promise<IC1LoserSettlement> {
  const contentions: IWriterContention[] = [];
  let value = initial;
  for (let reobservations = 0; ; reobservations += 1) {
    if (!isRecord(value)) { throw new TypeError(`C1 loser ${worker.name} returned a malformed acquisition`); }
    if (value.kind === 'held') {
      const held = { holder: holderField(value), expiresAt: integerField(value, 'expiresAt', 0) };
      if (held.holder !== winner.holder || held.expiresAt !== winner.expiresAt) {
        throw new Error(`C1 loser ${worker.name} observed a different held claim: ${JSON.stringify(held)}; prior nondecisions: ${JSON.stringify(contentions)}`);
      }
      return { held, contentions };
    }
    if (value.kind !== 'contended') {
      throw new TypeError(`C1 loser ${worker.name} must observe held or contended, never ${String(value.kind)}; prior nondecisions: ${JSON.stringify(contentions)}`);
    }
    contentions.push(contentionFrom(value));
    if (reobservations === maximumReobservations) {
      throw new Error(`C1 loser ${worker.name} exhausted ${String(maximumReobservations)} same-time re-observations: ${JSON.stringify(contentions)}`);
    }
    const reply = parseReply(await worker.step(request));
    if (!reply.ok) {
      throw new Error(`C1 loser ${worker.name} failed: ${reply.error}: ${reply.message}; prior nondecisions: ${JSON.stringify(contentions)}`);
    }
    value = reply.value;
  }
}
