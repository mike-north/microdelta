/**
 * Assembly-level support for durable History tests. It composes History's
 * durable authority with Node's real SQLite capability, exactly as production
 * assembly will, and adds only observation and fault injection around that
 * real backend: statement role logging, payload-cell counting, a controllable
 * clock, and a SIGKILL or throw just before a chosen transaction commits. It
 * never replaces storage with a test facade.
 * @packageDocumentation
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDurableHistory } from '@microdelta/history';
import type { IClockCapability, IDurableHistory, ISqliteCapability } from '@microdelta/history';
import { createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';

/** One real connection as History receives it from the capability. */
export type ISqliteConnection = ReturnType<ISqliteCapability['openSqlite']>;
/** One prepared real statement. */
export type ISqliteStatement = ReturnType<ISqliteConnection['prepare']>;
/** One returned row. */
export type ISqliteRow = NonNullable<ReturnType<ISqliteStatement['get']>>;
/** One bound value. */
export type ISqliteValue = Parameters<ISqliteStatement['run']>[number];

/** The Node host shared by tests; only its SHA-256 capability is used here. */
export const machine = createNodeMachine();

/**
 * Columns whose non-null cells carry author payload: the canonical root
 * payload, one indexed scalar leaf, or staged candidate content.
 */
const payloadColumns: ReadonlySet<string> = new Set(['payload', 'scalar', 'staged_payload']);

/** One executed statement, classified by its leading role comment. */
export interface IStatementEvent {
  readonly role: string;
  readonly rows: readonly ISqliteRow[];
}

/** Aggregated evidence for a window of statement executions. */
export interface IReadEvidence {
  /** Statements executed in the window. */
  readonly statements: number;
  /** Role tags executed, in first-execution order, with counts. */
  readonly roles: Readonly<Record<string, number>>;
  /** Non-null root `payload` cells returned. */
  readonly rootPayloadCells: number;
  /** Non-null scalar leaf cells returned. */
  readonly scalarCells: number;
  /** Non-null staged candidate cells returned. */
  readonly stagedCells: number;
}

/** Controls the fault injected before a transaction commits. */
export interface IFaultPlan {
  /** Role whose execution inside a transaction arms the fault. */
  readonly role: string;
  /** Kill the process with SIGKILL, or throw to exercise rollback in-process. */
  readonly action: 'kill' | 'throw';
}

/** A real SQLite capability with observation and optional pre-commit fault. */
export interface IObservedSqlite {
  readonly capability: ISqliteCapability;
  /** Number of logged statements; use as a window start. */
  mark(): number;
  /** Summarize statements from `start` to now. */
  evidence(start?: number): IReadEvidence;
  /** Arm a fault for later transactions; `undefined` disarms. */
  arm(plan: IFaultPlan | undefined): void;
}

/** Error thrown by an armed in-process fault. */
export class InjectedFault extends Error {
  public constructor(role: string) {
    super(`injected fault before commit of a ${role} transaction`);
    this.name = 'InjectedFault';
  }
}

/** Extract a statement's leading role tag. */
function roleOf(text: string): string {
  const match = /^\s*\/\*\s*([a-z-]+)\s*\*\//u.exec(text);
  return match?.[1] ?? 'untagged';
}

/**
 * Wrap Node's real SQLite capability. Every statement execution is logged;
 * when a transaction callback has executed a statement with the armed role,
 * the fault fires after the callback's SQL ran and before SQLite commits.
 */
export function observedSqlite(): IObservedSqlite {
  const real = createNodeSqlite();
  const events: IStatementEvent[] = [];
  let plan: IFaultPlan | undefined;
  let transactionRoles: Set<string> | undefined;

  const wrapStatement = (text: string, statement: ISqliteStatement): ISqliteStatement => {
    const role = roleOf(text);
    const note = (rows: readonly ISqliteRow[]): void => {
      events.push({ role, rows });
      transactionRoles?.add(role);
    };
    return {
      run(...values) {
        const result = statement.run(...values);
        note([]);
        return result;
      },
      get(...values) {
        const row = statement.get(...values);
        note(row === undefined ? [] : [row]);
        return row;
      },
      all(...values) {
        const rows = statement.all(...values);
        note(rows);
        return rows;
      },
    };
  };

  const capability: ISqliteCapability = {
    openSqlite(location: string): ISqliteConnection {
      const connection = real.openSqlite(location);
      const wrapped: ISqliteConnection = {
        exec: (text) => {
          connection.exec(text);
        },
        prepare: (text) => wrapStatement(text, connection.prepare(text)),
        transaction<T>(operation: () => T): T {
          // The real connection still refuses asynchronous results at runtime;
          // the wrapper only observes the callback, so it forwards `unknown`.
          return connection.transaction<unknown>(() => {
          const roles = new Set<string>();
          transactionRoles = roles;
          try {
            const result = operation();
            if (plan !== undefined && roles.has(plan.role)) {
              if (plan.action === 'kill') {
                process.kill(process.pid, 'SIGKILL');
              }
              throw new InjectedFault(plan.role);
            }
            return result;
          } finally {
            transactionRoles = undefined;
          }
          }) as T;
        },
        close: () => {
          connection.close();
        },
      };
      return wrapped;
    },
  };

  return {
    capability,
    mark: () => events.length,
    evidence(start = 0): IReadEvidence {
      const window = events.slice(start);
      const roles: Record<string, number> = {};
      let rootPayloadCells = 0;
      let scalarCells = 0;
      let stagedCells = 0;
      for (const event of window) {
        roles[event.role] = (roles[event.role] ?? 0) + 1;
        for (const row of event.rows) {
          for (const [column, cell] of Object.entries(row)) {
            if (!payloadColumns.has(column) || cell === null) {
              continue;
            }
            if (column === 'payload') {
              rootPayloadCells += 1;
            } else if (column === 'scalar') {
              scalarCells += 1;
            } else {
              stagedCells += 1;
            }
          }
        }
      }
      return { statements: window.length, roles, rootPayloadCells, scalarCells, stagedCells };
    },
    arm(next: IFaultPlan | undefined): void {
      plan = next;
    },
  };
}

/** A clock whose readings the test sets explicitly, or that throws. */
export interface IControlledClock extends IClockCapability {
  /** Set the next readings to this value. */
  set(reading: number): void;
  /** Make the next readings throw, simulating an unavailable host clock. */
  fail(): void;
}

/** Create a controlled clock starting at `initial` epoch milliseconds. */
export function controlledClock(initial: number): IControlledClock {
  let reading: number | undefined = initial;
  return {
    currentEpochMilliseconds(): number {
      if (reading === undefined) {
        throw new Error('host clock unavailable');
      }
      return reading;
    },
    set(next: number): void {
      reading = next;
    },
    fail(): void {
      reading = undefined;
    },
  };
}

/** The logical store most tests open. */
export const logicalStore = 'store:contributors';

/** Temporary directories created by a suite, removed after each test. */
const directories: string[] = [];

/** Create a fresh SQLite file location inside a unique temporary directory. */
export function freshLocation(): string {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-history-'));
  directories.push(directory);
  return join(directory, 'history.sqlite');
}

/** Stores opened by a test, closed before their files are removed. */
const opened: IDurableHistory[] = [];

/** Open a durable History over the real backend and remember it for cleanup. */
export function openHistory(options: {
  readonly location: string;
  readonly clock?: IClockCapability;
  readonly sqlite?: ISqliteCapability;
  readonly store?: string;
}): IDurableHistory {
  const history = openDurableHistory({
    sqlite: options.sqlite ?? createNodeSqlite(),
    clock: options.clock ?? controlledClock(1_000),
    sha256: machine,
    location: options.location,
    logicalStore: options.store ?? logicalStore,
  });
  opened.push(history);
  return history;
}

/** Open a raw real connection for inspection or deliberate tampering. */
export function openRaw(location: string): ISqliteConnection {
  const connection = createNodeSqlite().openSqlite(location);
  rawConnections.push(connection);
  return connection;
}

/** Raw connections opened by a test. */
const rawConnections: ISqliteConnection[] = [];

/** Close everything a test opened and remove its temporary files. */
export function cleanup(): void {
  for (const history of opened.splice(0)) {
    try {
      history.close();
    } catch {
      // A test may already have closed it.
    }
  }
  for (const connection of rawConnections.splice(0)) {
    connection.close();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The scope used by most tests. */
export const scope = { analysis: 'analysis:contributors', environment: 'env:fixture' } as const;

/** Provenance in an illustrative Resolution format History must not interpret. */
export function provenance(label: string): { readonly format: string; readonly formatVersion: number; readonly content: unknown } {
  return { format: 'test.resolution.provenance', formatVersion: 1, content: { label, observations: [{ path: ['profile', 'name'] }] } };
}

/**
 * The M3 contributor-activity fixture for Ada: nested profile, pull requests
 * with unread labels and a large unread note, and submitted reviews. Each call
 * returns fresh data so no container is shared between results.
 */
export function adaActivity(overrides: { readonly name?: string; readonly merged103?: boolean; readonly avatar?: string } = {}): unknown {
  return {
    profile: { id: 'gh:1001', name: overrides.name ?? 'Ada', avatarUrl: overrides.avatar ?? 'https://avatars.example/ada.png' },
    pullRequests: [
      { number: 101, merged: true, labels: ['feature'] },
      { number: 102, merged: true, labels: ['docs', 'small'] },
      { number: 103, merged: overrides.merged103 ?? false, labels: [] },
    ],
    reviews: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }, { id: 'r5' }],
    note: 'x'.repeat(100_000),
  };
}

/**
 * The accepted nested-read gate's Value edge-domain record (issue #54): key
 * order, sparse holes versus present undefined, two custom prototype levels
 * with shadowing, a null-prototype record, Property "0" versus Index 0, a
 * dotted key, NaN, negative zero, infinity, null and a `then` data field.
 * Copied because assembly tests may not import experiment code.
 */
export function domainRecord(): unknown {
  const grandparent = { depth: 'grandparent', shadowed: 'grandparent value' };
  const parent = Object.create(grandparent) as { inherited: string; shadowed: string; box: { readonly label: string } };
  parent.inherited = 'from prototype';
  parent.shadowed = 'parent value';
  parent.box = { label: 'inherited box' };
  const child = Object.create(parent) as { own: string };
  child.own = 'own value';
  const bare = Object.create(null) as { only: string };
  bare.only = 'null prototype';
  const sparse: unknown[] = new Array<unknown>(4);
  sparse[0] = 'first';
  sparse[3] = 'last';
  return {
    ordered: { zeta: 1, alpha: 2, mid: 3 },
    sparse,
    present: ['first', undefined, 'third'],
    child,
    bare,
    record: { '0': 'property zero', 'a.b': 'dotted key' },
    list: ['index zero'],
    numbers: { notANumber: Number.NaN, negativeZero: -0, infinity: Number.POSITIVE_INFINITY },
    nothing: null,
    then: 'legitimate author field',
  };
}
