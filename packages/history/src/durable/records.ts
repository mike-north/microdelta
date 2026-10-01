/**
 * Argument validation and stored-cell narrowing shared by History's durable
 * modules. Presented arguments that break a contract's shape are rejected
 * with `TypeError` before any storage work; stored cells that break History's
 * own invariants are integrity failures, never repaired. Owner-defined
 * versioned records are validated only by their tag, positive version and
 * supported Value content, stored in canonical MDS1 form and returned decoded
 * and frozen; their meaning is never interpreted here.
 * @packageDocumentation
 */
import type { ISqliteRow } from '@microdelta/machine';
import { decodeSnapshot, encodeSnapshot } from '@microdelta/value';

import type { IHistoryScope, IVersionedRecord } from './contracts.js';
import { HistoryIntegrityError } from './errors.js';

/** One owner-defined versioned record in its stored canonical form. */
export interface IStoredRecord {
  /** The owner's non-empty format identity. */
  readonly format: string;
  /** The owner's positive safe-integer format version. */
  readonly formatVersion: number;
  /** The content in canonical MDS1 text. */
  readonly content: string;
}

/** Require a non-empty string argument. */
export function requireName(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

/** Require a positive safe-integer argument. */
export function requirePositive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

/** Require a nonnegative safe-integer argument. */
export function requireNonnegative(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a nonnegative safe integer`);
  }
  return value;
}

/** Copy and validate an analysis/environment scope argument. */
export function historyScope(value: IHistoryScope): IHistoryScope {
  return { analysis: requireName(value.analysis, 'analysis'), environment: requireName(value.environment, 'environment') };
}

/** Add two safe integers or fail rather than round. */
export function safeSum(left: number, right: number, name: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError(`${name} exceeds the safe integer range`);
  }
  return sum;
}

/** Validate and canonicalize an owner-defined versioned record. */
export function storeRecord(record: IVersionedRecord, name: string): IStoredRecord {
  return {
    format: requireName(record.format, `${name} format`),
    formatVersion: requirePositive(record.formatVersion, `${name} format version`),
    content: encodeSnapshot(record.content),
  };
}

/** Decode a stored versioned record into frozen data, or fail as corruption. */
export function loadRecord(format: unknown, formatVersion: unknown, content: unknown, name: string): IVersionedRecord {
  if (typeof format !== 'string' || format.length === 0 || typeof formatVersion !== 'number' || !Number.isSafeInteger(formatVersion) || formatVersion <= 0 || typeof content !== 'string') {
    throw new HistoryIntegrityError(`Stored ${name} has a malformed version tag`);
  }
  let decoded: unknown;
  try {
    decoded = decodeSnapshot(content);
  } catch (error: unknown) {
    throw new HistoryIntegrityError(`Stored ${name} is not canonical MDS1: ${error instanceof Error ? error.message : String(error)}`);
  }
  return Object.freeze({ format, formatVersion, content: decoded });
}

/** Narrow a stored cell to text. */
export function text(row: ISqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new HistoryIntegrityError(`Stored History column ${column} is not text`);
  }
  return value;
}

/** Narrow a stored cell to a safe integer. */
export function integer(row: ISqliteRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new HistoryIntegrityError(`Stored History column ${column} is not an integer`);
  }
  return value;
}
