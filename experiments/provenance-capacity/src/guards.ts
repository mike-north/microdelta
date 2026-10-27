/** Pin bounded retained evidence to its exact cold listing meaning. @packageDocumentation */
import { createHash } from 'node:crypto';
import { encodeSelectedFact } from '@microdelta/value';
import type { IAddressSegment, IOperation } from '@microdelta/value';

/** Plain stored observation fields; selected address is a separate owned copy. */
interface IObservation {
  readonly binding: { readonly path: readonly string[] };
  readonly address: readonly IAddressSegment[];
  readonly selection: { readonly kind: string; readonly address: readonly IAddressSegment[]; readonly encodingVersion: string; readonly operation?: IOperation };
  readonly kind: string;
  readonly operation: string;
  readonly encodingVersion: string;
  readonly encoded: string;
  readonly fingerprint: string;
}
/** The exact source-owned plain content shape, without its separately stored format tag. */
interface IColdProvenance {
  readonly trackingSemantics: number;
  readonly kind: string;
  readonly step: { readonly scope: string; readonly role: string; readonly slot: string };
  readonly observations: readonly IObservation[];
  readonly children: readonly unknown[];
}
/** A record boundary never trusts unvalidated JSON or SQLite data. */
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) { throw new Error('expected record'); }
  return value as Record<string, unknown>;
}
/** Digest width and content are checked independently of byte totals. */
function digest(encoded: string): string { return createHash('sha256').update(encoded).digest('hex'); }
/** Fresh segments keep the tiny oracle within Value's no-shared-reference domain. */
function copyAddress(address: readonly IAddressSegment[]): readonly IAddressSegment[] { return address.map((segment) => ({ ...segment })); }

/**
 * @internal Construct at most 100 rows of mathematical shape controls. This is not a
 * callback capture; production encoding is used only for each tiny selected scalar fact.
 */
export function coldProvenance(n: number, implementationDigest: string): IColdProvenance {
  if (!Number.isSafeInteger(n) || n < 1 || n > 100 || !/^[a-f0-9]{64}$/u.test(implementationDigest)) { throw new Error('tiny shape bound'); }
  const encoded = `MDF1|${implementationDigest}`;
  const observations: IObservation[] = [{ binding: { path: ['self'] }, address: [], selection: { kind: 'implementation', address: [], encodingVersion: 'MDF1' }, kind: 'implementation', operation: 'implementation', encodingVersion: 'MDF1', encoded, fingerprint: digest(encoded) }];
  const fact = (address: readonly IAddressSegment[], operation: IOperation, value: unknown): void => {
    const text = encodeSelectedFact({ operation, address, fact: value });
    observations.push({ binding: { path: ['inputs'] }, address: copyAddress(address), selection: { kind: 'selected', operation, address: copyAddress(address), encodingVersion: 'MDO1' }, kind: 'fact', operation, encodingVersion: 'MDO1', encoded: text, fingerprint: digest(text) });
  };
  const rows: IAddressSegment = { kind: 'property', key: 'rows' };
  fact([rows], 'container-kind', 'array'); fact([rows], 'length', n);
  for (let index = 0; index < n; index++) {
    const at: readonly IAddressSegment[] = [rows, { kind: 'index', index }];
    fact(at, 'container-kind', 'record');
    fact([...at, { kind: 'property', key: 'key' }], 'value', `acme/widget#${String(index + 1)}`);
    fact([...at, { kind: 'property', key: 'score' }], 'value', index + 1);
    fact([...at, { kind: 'property', key: 'unread' }], 'value', 'baseline');
  }
  return { trackingSemantics: 2, kind: 'source', step: { scope: 'test5-selected-read', role: 'step', slot: 'listing' }, observations, children: [] };
}

/** @internal Require every tiny retained observation and field, including own key order. */
export function validateColdProvenance(value: unknown, n: number): void {
  const root = record(value);
  const observations: unknown = root['observations'];
  if (!Array.isArray(observations) || observations.length !== 4 * n + 3) { throw new Error('observation count'); }
  const first = record(observations[0]);
  const encoded = first['encoded'];
  if (typeof encoded !== 'string' || !/^MDF1\|[a-f0-9]{64}$/u.test(encoded)) { throw new Error('implementation fact'); }
  const expected = coldProvenance(n, encoded.slice(5));
  if (JSON.stringify(value) !== JSON.stringify(expected)) { throw new Error('cold shape, ordered identity or fact mismatch'); }
}

/** @internal Require one exact cold scalar row and reject oversized/unmeasured cell returns. */
export function validateScalarRows(rows: readonly unknown[], result: number, n: number, cap = 1048576): unknown {
  if (rows.length !== 1 || !Number.isSafeInteger(result) || result < 1 || !Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(cap) || cap < 1) { throw new Error('selection cardinality or bound'); }
  const row = record(rows[0]);
  const characters = row['characters']; const bytes = row['bytes'];
  if (row['result'] !== result || row['subject'] !== 'listing' || row['version'] !== 1 || row['format'] !== 'microdelta.resolution.provenance' || row['formatVersion'] !== 1 || row['prefix'] !== 'MDS1|' || row['observations'] !== 4 * n + 3 || typeof characters !== 'number' || !Number.isSafeInteger(characters) || characters < 5 || bytes !== characters) { throw new Error('scalar identity/ASCII/count mismatch'); }
  const cell = row['cell'];
  if (cell !== undefined && (typeof cell !== 'string' || bytes > cap || Buffer.byteLength(cell) > cap || cell.length !== characters || Buffer.byteLength(cell) !== bytes)) { throw new Error('unmeasured or oversized returned cell'); }
  return row;
}
