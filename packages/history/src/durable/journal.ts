/**
 * Run Supervision's operation journal inside History's durable authority
 * (RUN-011/012, ARC-007). History stores Supervision's operation and deferral
 * records as opaque versioned records, following the pattern of Resolution's
 * provenance: it owns their environment namespace, format collection, key,
 * revision, commit sequence and committing fence, and never interprets their
 * content. EXP-8 selected the semantics this port must support: an intent
 * committed before a send, a deferral with a "not before" time, and
 * compare-and-set transitions between operation states. Deciding what any of
 * those states mean, including whether a deferral may be cleared, remains
 * Supervision's responsibility.
 *
 * Each commit is one IMMEDIATE transaction that first checks the writer's
 * holder, fence and unexpired lease, then every compare-and-set expectation,
 * then inserts a new immutable revision per write:
 *
 * | Transition | Durable change | Death before commit | Death after commit |
 * | --- | --- | --- | --- |
 * | journal commit | one new revision per write, journal sequence + writes | no revision, no sequence issued | every revision durable; readers see them all |
 *
 * A port is bound to the record formats and versions its caller understands.
 * A record of any other version is refused on write, and a stored record of
 * any other version is refused on read, list or overwrite, so an older caller
 * never acts on or clobbers a record written by a newer format version.
 * @packageDocumentation
 */
import type { ISqliteConnection, ISqliteRow } from '@microdelta/machine';

import type {
  IHistoryScope,
  IJournalAddress,
  IJournalCommit,
  IJournalDeclaration,
  IJournalFormat,
  IJournalQuery,
  IJournalRecord,
  IOperationJournal,
  IWriterLease,
} from './contracts.js';
import { HistoryIntegrityError, JournalConflictError, JournalVersionError } from './errors.js';
import { historyScope, integer, loadRecord, requireName, requireNonnegative, requirePositive, safeSum, storeRecord, text } from './records.js';
import type { IStoredRecord } from './records.js';

/** Identity tag for embedded SQL; the text is passed through unchanged. */
const sql = String.raw;

/**
 * Runs one ownership-sensitive mutation inside the authority's writer
 * transaction, after the holder, fence and unexpired-lease check. A stale
 * lease is refused with no change other than the observed clock high-water.
 */
export type IHolderTransaction = <T>(lease: IWriterLease, operation: () => T) => T;

/** Opens journal ports that share the authority's connection and writer check. */
export interface IJournalStore {
  /** Bind a journal port to the declared formats and versions. */
  open(declaration: IJournalDeclaration): IOperationJournal;
}

/** One validated write, ready to check and insert. */
interface IPreparedWrite {
  readonly key: string;
  readonly expectedRevision: number;
  readonly record: IStoredRecord;
}

/** Validate a declaration into a frozen copy and a lookup of declared versions. */
function declaredFormats(declaration: IJournalDeclaration): { readonly formats: readonly IJournalFormat[]; readonly versions: ReadonlyMap<string, ReadonlySet<number>> } {
  const presented: unknown = declaration.formats;
  if (!Array.isArray(presented) || presented.length === 0) {
    throw new TypeError('A journal declaration needs at least one format');
  }
  const versions = new Map<string, ReadonlySet<number>>();
  const formats = declaration.formats.map((entry): IJournalFormat => {
    const format = requireName(entry.format, 'journal format');
    const listed: unknown = entry.versions;
    if (!Array.isArray(listed) || listed.length === 0) {
      throw new TypeError(`Journal format ${format} needs at least one version`);
    }
    const accepted = entry.versions.map((version) => requirePositive(version, `journal format ${format} version`));
    if (new Set(accepted).size !== accepted.length) {
      throw new TypeError(`Journal format ${format} declares a version twice`);
    }
    if (versions.has(format)) {
      throw new TypeError(`Journal format ${format} is declared twice`);
    }
    versions.set(format, new Set(accepted));
    return Object.freeze({ format, versions: Object.freeze(accepted) });
  });
  return { formats: Object.freeze(formats), versions };
}

/**
 * Create the journal store over one open, validated connection. Statements
 * are prepared once; every port shares them, the writer check and the
 * store-wide journal sequence.
 */
export function createJournalStore(connection: ISqliteConnection, asHolder: IHolderTransaction): IJournalStore {
  const statements = {
    sequence: connection.prepare(sql`/* journal */ SELECT last_journal FROM history_sequences WHERE singleton = 1`),
    setSequence: connection.prepare(sql`/* journal */ UPDATE history_sequences SET last_journal = ? WHERE singleton = 1`),
    current: connection.prepare(sql`/* journal */ SELECT * FROM history_journal
      WHERE analysis = ? AND environment = ? AND format = ? AND journal_key = ? ORDER BY revision DESC LIMIT 1`),
    insert: connection.prepare(sql`/* journal */ INSERT INTO history_journal
      (analysis, environment, format, journal_key, revision, sequence, fence, format_version, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    list: connection.prepare(sql`/* journal */ SELECT j.* FROM history_journal j
      JOIN history_journal first ON first.analysis = j.analysis AND first.environment = j.environment AND first.format = j.format
        AND first.journal_key = j.journal_key AND first.revision = 1
      WHERE j.analysis = ? AND j.environment = ? AND j.format = ?
        AND j.revision = (SELECT max(k.revision) FROM history_journal k
          WHERE k.analysis = j.analysis AND k.environment = j.environment AND k.format = j.format AND k.journal_key = j.journal_key)
      ORDER BY first.sequence`),
  };

  /** Read and narrow the store-wide journal sequence inside the caller's transaction. */
  function lastSequence(): number {
    const row = statements.sequence.get();
    if (row === undefined) {
      throw new HistoryIntegrityError('History sequence row is missing');
    }
    return integer(row, 'last_journal');
  }

  return Object.freeze({
    open(declaration: IJournalDeclaration): IOperationJournal {
      const { formats, versions } = declaredFormats(declaration);

      /** Refuse a format this port never declared. */
      function declaredVersions(format: string): ReadonlySet<number> {
        const accepted = versions.get(format);
        if (accepted === undefined) {
          throw new JournalVersionError(`Journal format ${format} is not declared by this journal port`);
        }
        return accepted;
      }

      /** Refuse a format version this port never declared, for a presented or stored record. */
      function requireDeclared(format: string, formatVersion: number, subject: string): void {
        if (!declaredVersions(format).has(formatVersion)) {
          throw new JournalVersionError(`${subject} uses ${format} version ${String(formatVersion)}, which this journal port does not declare`);
        }
      }

      /** Convert one stored revision to its frozen record, refusing an undeclared stored version. */
      function recordOf(row: ISqliteRow, expected: IHistoryScope & { readonly format: string }): IJournalRecord {
        const format = text(row, 'format');
        const key = text(row, 'journal_key');
        if (text(row, 'analysis') !== expected.analysis || text(row, 'environment') !== expected.environment || format !== expected.format) {
          throw new HistoryIntegrityError(`Stored journal record ${key} is outside the requested namespace`);
        }
        const formatVersion = integer(row, 'format_version');
        requireDeclared(format, formatVersion, `Stored journal record ${key}`);
        return Object.freeze({
          analysis: expected.analysis,
          environment: expected.environment,
          key,
          revision: requirePositiveStored(integer(row, 'revision'), 'revision'),
          sequence: requirePositiveStored(integer(row, 'sequence'), 'sequence'),
          fence: requirePositiveStored(integer(row, 'fence'), 'fence'),
          record: loadRecord(format, formatVersion, row.content, 'journal record'),
        });
      }

      /** The current revision of one address inside or outside a transaction. */
      function currentRow(address: IJournalAddress): ISqliteRow | undefined {
        return statements.current.get(address.analysis, address.environment, address.format, address.key);
      }

      /** Validate every write before any storage work, refusing ambiguous or undeclared ones. */
      function prepareWrites(request: IJournalCommit): readonly IPreparedWrite[] {
        const presented: unknown = request.writes;
        if (!Array.isArray(presented) || presented.length === 0) {
          throw new TypeError('A journal commit needs at least one write');
        }
        const seen = new Set<string>();
        return request.writes.map((write) => {
          const key = requireName(write.key, 'journal key');
          const expectedRevision = requireNonnegative(write.expectedRevision, 'expected journal revision');
          const record = storeRecord(write.record, 'journal record');
          const identity = JSON.stringify([record.format, key]);
          if (seen.has(identity)) {
            throw new TypeError(`Journal commit writes ${record.format} key ${key} more than once`);
          }
          seen.add(identity);
          requireDeclared(record.format, record.formatVersion, `Journal write ${key}`);
          return { key, expectedRevision, record };
        });
      }

      const journal: IOperationJournal = {
        formats,

        commit(lease: IWriterLease, request: IJournalCommit): readonly IJournalRecord[] {
          const scope = historyScope(request);
          const writes = prepareWrites(request);
          return asHolder(lease, () => {
            // Every expectation is checked before the first insert, so a refused commit writes nothing.
            const revisions = writes.map((write) => {
              const address = { ...scope, format: write.record.format, key: write.key };
              const row = currentRow(address);
              const current = row === undefined ? 0 : integer(row, 'revision');
              if (row !== undefined) {
                // Never overwrite a record whose stored version this port does not understand.
                requireDeclared(address.format, integer(row, 'format_version'), `Stored journal record ${write.key}`);
              }
              if (current !== write.expectedRevision) {
                throw new JournalConflictError(
                  `Journal ${address.format} key ${write.key} is at revision ${String(current)}, not the expected ${String(write.expectedRevision)}`,
                );
              }
              return safeSum(current, 1, 'journal revision');
            });
            let sequence = lastSequence();
            const committed = writes.map((write, index) => {
              sequence = safeSum(sequence, 1, 'journal sequence');
              const revision = revisions[index];
              if (revision === undefined) {
                throw new HistoryIntegrityError('Journal commit lost a prepared revision');
              }
              statements.insert.run(scope.analysis, scope.environment, write.record.format, write.key, revision, sequence, lease.fence, write.record.formatVersion, write.record.content);
              const row = currentRow({ ...scope, format: write.record.format, key: write.key });
              if (row === undefined) {
                throw new HistoryIntegrityError(`Committed journal record ${write.key} is not readable`);
              }
              return recordOf(row, { ...scope, format: write.record.format });
            });
            statements.setSequence.run(sequence);
            return Object.freeze(committed);
          });
        },

        read(presented: IJournalAddress): IJournalRecord | undefined {
          const address = { ...historyScope(presented), format: requireName(presented.format, 'journal format'), key: requireName(presented.key, 'journal key') };
          declaredVersions(address.format);
          const row = currentRow(address);
          return row === undefined ? undefined : recordOf(row, address);
        },

        list(presented: IJournalQuery): readonly IJournalRecord[] {
          const query = { ...historyScope(presented), format: requireName(presented.format, 'journal format') };
          declaredVersions(query.format);
          return Object.freeze(statements.list.all(query.analysis, query.environment, query.format).map((row) => recordOf(row, query)));
        },
      };
      return Object.freeze(journal);
    },
  });
}

/** A stored identity that must be positive; anything else is corruption. */
function requirePositiveStored(value: number, column: string): number {
  if (value <= 0) {
    throw new HistoryIntegrityError(`Stored journal ${column} ${String(value)} is not positive`);
  }
  return value;
}
