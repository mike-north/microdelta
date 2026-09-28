/**
 * Read-request instrumentation around Machine's portable SQLite connection.
 * Every prepared statement execution is logged with its role tag, bound
 * values and returned rows, so the experiment can count exactly which author
 * payload cells a selected read or fingerprint lookup returned. Payload is
 * identified by column, independently of the candidate's role tags.
 */
import type { ISqliteConnection, ISqliteRow, ISqliteStatement, ISqliteValue } from '@microdelta/machine';

/** Columns whose non-null cells contain author payload in the candidate layout. */
const payloadColumns: ReadonlySet<string> = new Set(['payload', 'scalar']);

/** One executed statement. */
export interface IStatementEvent {
  /** The leading role comment, such as `leaf-payload` or `fingerprint`. */
  readonly role: string;
  readonly values: readonly ISqliteValue[];
  readonly rows: readonly ISqliteRow[];
}

/** Aggregated read evidence for a window of statement events. */
export interface IReadEvidence {
  readonly statements: number;
  /** Executions per role tag, in first-execution order. */
  readonly roles: Readonly<Record<string, number>>;
  /** Non-null payload cells returned. */
  readonly payloadCells: number;
  /** Total UTF-16 length of returned payload cells. */
  readonly payloadCharacters: number;
  /** Every structured-address encoding bound to a statement, including prefix lists. */
  readonly boundAddresses: readonly string[];
}

/** An instrumented connection with its event log. */
export interface IInstrumentedConnection {
  readonly connection: ISqliteConnection;
  /** Number of events so far; use as a window start. */
  mark(): number;
  /** Summarize events from `start` (inclusive) to now. */
  evidence(start?: number): IReadEvidence;
}

/** Extract the role tag of a statement. */
function roleOf(text: string): string {
  const match = /^\s*\/\*\s*([a-z-]+)\s*\*\//u.exec(text);
  return match?.[1] ?? 'untagged';
}

/** Address encodings are JSON arrays of ['p', key] / ['i', index] pairs. */
function addressesIn(value: ISqliteValue): readonly string[] {
  if (typeof value !== 'string' || !value.startsWith('[')) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    if (parsed.every((segment) => Array.isArray(segment))) {
      return [value];
    }
    // A json_each list of prefix encodings.
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.startsWith('['));
  } catch {
    return [];
  }
}

/** Wrap a connection so every statement read is logged. */
export function instrument(connection: ISqliteConnection): IInstrumentedConnection {
  const events: IStatementEvent[] = [];
  const wrapStatement = (text: string, statement: ISqliteStatement): ISqliteStatement => {
    const role = roleOf(text);
    return {
      run(...values) {
        events.push({ role, values, rows: [] });
        return statement.run(...values);
      },
      get(...values) {
        const row = statement.get(...values);
        events.push({ role, values, rows: row === undefined ? [] : [row] });
        return row;
      },
      all(...values) {
        const rows = statement.all(...values);
        events.push({ role, values, rows });
        return rows;
      },
    };
  };
  const wrapped: ISqliteConnection = {
    exec: (text) => { connection.exec(text); },
    prepare: (text) => wrapStatement(text, connection.prepare(text)),
    transaction: (operation) => connection.transaction(operation),
    close: () => { connection.close(); },
  };
  return {
    connection: wrapped,
    mark: () => events.length,
    evidence(start = 0): IReadEvidence {
      const window = events.slice(start);
      const roles: Record<string, number> = {};
      let payloadCells = 0;
      let payloadCharacters = 0;
      const boundAddresses: string[] = [];
      for (const event of window) {
        roles[event.role] = (roles[event.role] ?? 0) + 1;
        boundAddresses.push(...event.values.flatMap(addressesIn));
        for (const row of event.rows) {
          for (const [column, cell] of Object.entries(row)) {
            if (payloadColumns.has(column) && cell !== null) {
              payloadCells += 1;
              payloadCharacters += typeof cell === 'string' ? cell.length : cell.toString().length;
            }
          }
        }
      }
      return { statements: window.length, roles, payloadCells, payloadCharacters, boundAddresses };
    },
  };
}
