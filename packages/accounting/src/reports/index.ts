/**
 * Accounting's raw report retention authority. Dedicated storage prevents state
 * eviction from touching immutable consumption or execution evidence. Original
 * observation determines age; reports are never reduced into a current balance.
 * Active writers maintain expiry with an injected timer; readers only filter it.
 * @packageDocumentation
 */
import type { ISqliteConnection } from '@microdelta/machine';
import type { IRetainedResourceReport, IResourceReport, IResourceReportReader, IResourceReportReaderOptions, IResourceReports, IResourceReportsOptions } from './contracts.js';
import { initializeSchema, verifySchema } from './schema.js';
import { fromRow, identity, integer, normalize } from './validation.js';
import { writeFailure } from '../sqlite/index.js';

/** Failed scheduled cleanup retries in one minute; persistent storage failure cannot promise eviction. */
const maintenanceRetryMilliseconds = 60_000;

/** Commit acknowledgment is returned only after host transaction success. */
function write<T>(connection: ISqliteConnection, operation: () => T): T {
  let outcome: { readonly value: T } | undefined;
  try {
    connection.transaction(() => { outcome = { value: operation() }; });
  } catch (error: unknown) { throw writeFailure('resource report', error, outcome !== undefined); }
  if (outcome === undefined) { throw new Error('Resource report transaction did not run'); }
  return outcome.value;
}

/**
 * Open the dedicated report writer and physically remove expired rows before
 * returning. Each intake and scheduled expiry also removes expired rows. A
 * permanently unavailable storage device is reported and retried, never hidden.
 * @alpha
 */
export function openResourceReports(options: IResourceReportsOptions): IResourceReports {
  identity(options.logicalStore);
  const connection = options.sqlite.openSqlite(options.location, { journalMode: 'delete' });
  let closed = false;
  let cancel: (() => void) | undefined;

  /** Ended handles never write, including callbacks already queued when close occurred. */
  function assertOpen(): void { if (closed) { throw new Error('Resource report writer is closed'); } }

  /** One captured clock reading supplies the inclusive deletion boundary. */
  function evict(): number {
    return connection.prepare('DELETE FROM resource_reports WHERE expires_at <= ?').run(integer(options.timer.currentEpochMilliseconds())).changes;
  }

  /** Schedule an Accounting-owned cleanup callback, not provider work or admission. */
  function schedule(at: number): void {
    const previous = cancel;
    const replacement = options.timer.schedule(at, () => {
      if (closed) { return; }
      cancel = undefined;
      try { maintain(); }
      catch (error: unknown) {
        if (!closed) { schedule(integer(options.timer.currentEpochMilliseconds() + maintenanceRetryMilliseconds)); }
        notifyFailure(error);
      }
    }, { keepAlive: false });
    // Host timers never invoke synchronously: replacement can be installed
    // before canceling the prior deadline, preserving it if scheduling fails.
    cancel = replacement;
    previous?.();
  }

  /** Error observers do not own maintenance lifetime and cannot crash its timer turn. */
  function notifyFailure(error: unknown): void {
    try { options.onMaintenanceError(error); }
    catch {
      // The original failure was delivered. An observer's own exception must
      // not disable already-armed storage recovery or terminate the host.
    }
  }

  /** Known expiry and a one-minute poll bound idle accumulation, including writes from other handles. */
  function arm(): void {
    const row = connection.prepare('SELECT MIN(expires_at) AS expiry FROM resource_reports').get();
    const pollAt = integer(options.timer.currentEpochMilliseconds() + maintenanceRetryMilliseconds);
    const expiry = row?.['expiry'];
    schedule(expiry === null || expiry === undefined ? pollAt : Math.min(integer(expiry), pollAt));
  }

  /** Explicit and scheduled maintenance share the same transaction and scheduling lifecycle. */
  function maintain(): number {
    assertOpen();
    const removed = write(connection, evict);
    arm();
    return removed;
  }

  try {
    write(connection, () => { initializeSchema(connection, options.logicalStore); evict(); });
    arm();
  } catch (error: unknown) { cancel?.(); connection.close(); throw error; }

  return Object.freeze({
    record(input: IResourceReport): 'recorded' | 'duplicate' {
      assertOpen();
      const report = normalize(input);
      const now = integer(options.timer.currentEpochMilliseconds());
      if (report.observedAt > now) { throw new TypeError('Resource report observation is in the future'); }
      if (report.expiresAt <= now) { throw new TypeError('Resource report is expired'); }
      const result = write(connection, () => {
        evict();
        const previous = connection.prepare('SELECT * FROM resource_reports WHERE environment = ? AND report = ?').get(report.environment, report.report);
        if (previous !== undefined) {
          if (JSON.stringify(fromRow(previous)) !== JSON.stringify(report)) { throw new Error('Resource report identity conflict'); }
          return 'duplicate';
        }
        connection.prepare(`INSERT INTO resource_reports (
          environment, report, observed_at, valid_until, local_retention,
          provider, service, account, pool, resource, unit, window, allowed, remaining, expires_at, retention_basis
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          report.environment, report.report, report.observedAt, report.validUntil, report.localRetentionMilliseconds,
          report.provider, report.service, report.account, report.pool, report.resource, report.unit, report.window,
          report.allowed, report.remaining, report.expiresAt, report.retentionBasis,
        );
        return 'recorded';
      });
      // Persistence already committed. A scheduling read failure is a separate
      // maintenance concern; the old bounded poll remains armed and the durable
      // acknowledgment must not be misreported as a failed persistence attempt.
      try { arm(); }
      catch (error: unknown) { notifyFailure(error); }
      return result;
    },
    maintain,
    close(): void {
      if (closed) { return; }
      closed = true;
      cancel?.();
      cancel = undefined;
      connection.close();
    },
  });
}

/** Open existing evidence read-only; missing/empty/foreign storage fails without initialization. @alpha */
export function openResourceReportReader(options: IResourceReportReaderOptions): IResourceReportReader {
  identity(options.logicalStore);
  const connection = options.sqlite.openSqliteReader(options.location);
  try { verifySchema(connection, options.logicalStore); }
  catch (error: unknown) { connection.close(); throw error; }
  return Object.freeze({
    query(environment: string): readonly IRetainedResourceReport[] {
      return connection.prepare('SELECT * FROM resource_reports WHERE environment = ? AND expires_at > ? ORDER BY report')
        .all(identity(environment), integer(options.clock.currentEpochMilliseconds())).map(fromRow);
    },
    close: connection.close,
  });
}
