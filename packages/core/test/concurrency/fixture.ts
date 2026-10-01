/**
 * Fixed data shared by the M5 concurrency suites and their worker processes:
 * one logical store, one scoped subject, attempt requests derived from a
 * caller key, and a payload large enough that a partially installed result
 * would be visible. Parent and workers derive the same values independently,
 * so nothing but the SQLite file carries state between processes.
 * @packageDocumentation
 */
import type { IAttemptRequest, IScopedSubject, IVersionedRecord } from '@microdelta/history';
import type { IAddressSegment } from '@microdelta/value';

/** The logical store every process in these suites opens. */
export const concurrencyStore = 'store:m5-concurrency';

/** The one scoped subject whose history the contending workers write. */
export const subject: IScopedSubject = Object.freeze({
  analysis: 'analysis:m5-concurrency',
  environment: 'env:m5',
  subject: 'summary:acme/widget:2026-Q1:person:ada',
});

/** Number of parts in every staged payload; the last one is read back to detect truncation. */
export const partCount = 64;

/**
 * The stable execution request for one caller key. The intent digest is
 * derived from the key, so reusing a key names the same execution.
 */
export function attemptRequest(key: string): IAttemptRequest {
  return { ...subject, version: 1, attemptKey: key, intentDigest: `intent:${key}` };
}

/** A payload whose every part carries the label, so a read of any part identifies its producer. */
export function payload(label: string): unknown {
  return { label, parts: Array.from({ length: partCount }, (_, index) => ({ index, label })) };
}

/** Provenance in an illustrative Resolution format History stores but never interprets. */
export function provenance(label: string): IVersionedRecord {
  return { format: 'test.resolution.provenance', formatVersion: 1, content: { label } };
}

/** Evidence for abandonment or acceptance, in an illustrative owner format. */
export function evidence(reason: string): IVersionedRecord {
  return { format: 'test.m5.evidence', formatVersion: 1, content: { reason } };
}

/** The address of a payload's label. */
export const labelAddress: readonly IAddressSegment[] = Object.freeze([{ kind: 'property', key: 'label' }]);

/** The address of the last part's label, which only a complete payload can answer. */
export const lastPartAddress: readonly IAddressSegment[] = Object.freeze([
  { kind: 'property', key: 'parts' },
  { kind: 'index', index: partCount - 1 },
  { kind: 'property', key: 'label' },
]);
