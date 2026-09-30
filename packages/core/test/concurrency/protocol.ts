/**
 * The message protocol between the M5 concurrency suites and their worker
 * processes. A worker is a long-lived Node process that owns one History
 * handle over the shared SQLite file, the lease objects it was granted, the
 * attempts it allocated and a clock the parent sets per command. The parent
 * sends one command at a time to the worker it chooses, which is how a test
 * fixes the global order of operations across processes; sending to several
 * workers at once is how it makes them contend for real.
 *
 * Both directions cross a process boundary as untyped JSON, so each side
 * narrows what it receives here instead of trusting its shape.
 * @packageDocumentation
 */
import type { IWriterLease } from '@microdelta/history';

/**
 * The clock a worker's History evaluates leases against: `controlled` reads
 * whatever the parent last set (every mutating command carries its reading);
 * `host` is Node's real wall clock.
 */
export type IWorkerClock = 'controlled' | 'host';

/** How the parent starts one worker. */
export interface IWorkerLaunch {
  /** The shared SQLite file. */
  readonly location: string;
  /** The logical store every process opens. */
  readonly store: string;
  /** Which clock History is given. */
  readonly clock: IWorkerClock;
}

/**
 * One History operation the parent asks a worker to perform. `at` is the
 * controlled clock reading for that operation; read-only commands carry none,
 * and the worker makes its clock fail while they run, so a read that consulted
 * or persisted time would be refused. `notBefore` (host epoch milliseconds)
 * holds the command until that instant, which lines up several workers.
 * Attempts are named by a caller key; the worker maps keys to the attempt
 * identities it was given.
 */
export type IHarnessCommand = (
  | { readonly op: 'acquire'; readonly at: number; readonly holder: string; readonly leaseMilliseconds: number }
  | { readonly op: 'renew'; readonly at: number; readonly leaseMilliseconds: number }
  | { readonly op: 'release'; readonly at: number }
  | { readonly op: 'allocate'; readonly at: number; readonly key: string }
  | { readonly op: 'stage'; readonly at: number; readonly key: string; readonly label: string }
  | { readonly op: 'publish'; readonly at: number; readonly key: string }
  | { readonly op: 'abandon'; readonly at: number; readonly key: string }
  | { readonly op: 'accept'; readonly at: number; readonly locator: string }
  | { readonly op: 'recover'; readonly key: string }
  | { readonly op: 'inspect' }
  | { readonly op: 'read'; readonly locator: string }
  | { readonly op: 'arm'; readonly role: string }
  | { readonly op: 'contend'; readonly holder: string; readonly durationMilliseconds: number; readonly leaseMilliseconds: number }
  | { readonly op: 'close' }
) & { readonly notBefore?: number };

/** The operation names a command may carry. */
export type IHarnessOperation = IHarnessCommand['op'];

/**
 * A worker's answer to one command: the operation's JSON value, or the
 * class name and message of what it threw.
 */
export type IHarnessReply =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string; readonly message: string };

/**
 * One event of a free-running contention loop (`contend`), in the order the
 * worker observed it. `fence` is the lease the worker presented or was
 * granted; `error` is the class name of a refusal.
 */
export interface IContentionEvent {
  /** What the worker attempted. */
  readonly op: 'acquire' | 'allocate' | 'stage' | 'publish' | 'renew';
  /** Whether History accepted it (acquisition: granted). */
  readonly ok: boolean;
  /** The fence granted or presented; 0 when the worker held none. */
  readonly fence: number;
  /** For a `held` acquisition, the holder History named. */
  readonly heldBy?: string;
  /** For a refusal, the thrown class name. */
  readonly error?: string;
}

/** Whether a value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a required string member or fail with the member's name. */
export function stringField(record: Readonly<Record<string, unknown>>, name: string): string {
  const value = record[name];
  if (typeof value !== 'string') {
    throw new TypeError(`expected string member ${name}, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** Read a required finite number member or fail with the member's name. */
export function numberField(record: Readonly<Record<string, unknown>>, name: string): number {
  const value = record[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`expected number member ${name}, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** Read an optional finite number member. */
function optionalNumber(record: Readonly<Record<string, unknown>>, name: string): number | undefined {
  return record[name] === undefined ? undefined : numberField(record, name);
}

/** Narrow a launch description received on the worker's command line. */
export function parseLaunch(value: unknown): IWorkerLaunch {
  if (!isRecord(value)) {
    throw new TypeError('worker launch must be an object');
  }
  const clock = value.clock;
  if (clock !== 'controlled' && clock !== 'host') {
    throw new TypeError(`unsupported worker clock ${JSON.stringify(clock)}`);
  }
  return { location: stringField(value, 'location'), store: stringField(value, 'store'), clock };
}

/** Attach the optional barrier to a parsed command. */
function withBarrier<T extends object>(command: T, notBefore: number | undefined): T & { readonly notBefore?: number } {
  return notBefore === undefined ? command : { ...command, notBefore };
}

/** Narrow one command received by a worker; an unknown shape is a harness error. */
export function parseCommand(value: unknown): IHarnessCommand {
  if (!isRecord(value)) {
    throw new TypeError('harness command must be an object');
  }
  const notBefore = optionalNumber(value, 'notBefore');
  const op = stringField(value, 'op');
  switch (op) {
    case 'acquire':
      return withBarrier({ op, at: numberField(value, 'at'), holder: stringField(value, 'holder'), leaseMilliseconds: numberField(value, 'leaseMilliseconds') }, notBefore);
    case 'renew':
      return withBarrier({ op, at: numberField(value, 'at'), leaseMilliseconds: numberField(value, 'leaseMilliseconds') }, notBefore);
    case 'release':
      return withBarrier({ op, at: numberField(value, 'at') }, notBefore);
    case 'allocate':
    case 'publish':
    case 'abandon':
      return withBarrier({ op, at: numberField(value, 'at'), key: stringField(value, 'key') }, notBefore);
    case 'stage':
      return withBarrier({ op, at: numberField(value, 'at'), key: stringField(value, 'key'), label: stringField(value, 'label') }, notBefore);
    case 'accept':
      return withBarrier({ op, at: numberField(value, 'at'), locator: stringField(value, 'locator') }, notBefore);
    case 'recover':
      return withBarrier({ op, key: stringField(value, 'key') }, notBefore);
    case 'inspect':
    case 'close':
      return withBarrier({ op }, notBefore);
    case 'read':
      return withBarrier({ op, locator: stringField(value, 'locator') }, notBefore);
    case 'arm':
      return withBarrier({ op, role: stringField(value, 'role') }, notBefore);
    case 'contend':
      return withBarrier({ op, holder: stringField(value, 'holder'), durationMilliseconds: numberField(value, 'durationMilliseconds'), leaseMilliseconds: numberField(value, 'leaseMilliseconds') }, notBefore);
    default:
      throw new TypeError(`unsupported harness operation ${op}`);
  }
}

/** Narrow one reply received by the parent. */
export function parseReply(value: unknown): IHarnessReply {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new TypeError(`malformed worker reply ${JSON.stringify(value)}`);
  }
  return value.ok ? { ok: true, value: value.value } : { ok: false, error: stringField(value, 'error'), message: stringField(value, 'message') };
}

/** Narrow a lease value. */
export function parseLease(value: unknown): IWriterLease {
  if (!isRecord(value)) {
    throw new TypeError(`expected a writer lease, got ${JSON.stringify(value)}`);
  }
  return { holder: stringField(value, 'holder'), fence: numberField(value, 'fence'), expiresAt: numberField(value, 'expiresAt') };
}

/** Narrow the events a contention loop returned. */
export function parseContentionLog(value: unknown): readonly IContentionEvent[] {
  if (!Array.isArray(value)) {
    throw new TypeError('expected a contention log array');
  }
  return value.map((entry: unknown): IContentionEvent => {
    if (!isRecord(entry)) {
      throw new TypeError('contention event must be an object');
    }
    const op = stringField(entry, 'op');
    if (op !== 'acquire' && op !== 'allocate' && op !== 'stage' && op !== 'publish' && op !== 'renew') {
      throw new TypeError(`unsupported contention event ${op}`);
    }
    if (typeof entry.ok !== 'boolean') {
      throw new TypeError('contention event needs a boolean outcome');
    }
    const heldBy = entry.heldBy === undefined ? {} : { heldBy: stringField(entry, 'heldBy') };
    const error = entry.error === undefined ? {} : { error: stringField(entry, 'error') };
    return { op, ok: entry.ok, fence: numberField(entry, 'fence'), ...heldBy, ...error };
  });
}
