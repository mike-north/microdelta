/** Test-only assembly accounting of actual cold tuple output; no Resolution-private dependency. @packageDocumentation */
import { createHash } from 'node:crypto';
import { encodeSelectedFact, encodeSnapshot } from '@microdelta/value';
import type { IAddressSegment, IOperation } from '@microdelta/value';
import { coldProvenance } from './guards.js';
import { digitSum, exactAdd, snapshotLengths } from './length.js';

/** The exact independently reconstructed ordinary cold source tuple root. */
interface IColdTuple {
  readonly trackingSemantics: 2; readonly semanticVersion: 1; readonly kind: 'source';
  readonly step: { readonly scope: string; readonly role: string; readonly slot: string };
  readonly observations: readonly unknown[]; readonly children: readonly unknown[];
}
/** The selected fixture's address grammar is independent of the owner codec implementation. */
function address(segments: ReturnType<typeof coldProvenance>['observations'][number]['address']): readonly unknown[] {
  return segments.map((segment) => segment.kind === 'property' ? [0, segment.key] : [1, segment.index]);
}
/** Reconstruct only the two selections in the pinned cold source, retaining all eight fields. */
function observation(item: ReturnType<typeof coldProvenance>['observations'][number]): readonly unknown[] {
  const selection = item.selection.kind === 'implementation' ? [1, address(item.selection.address)]
    : [0, item.selection.operation === 'container-kind' ? 5 : item.selection.operation === 'length' ? 3 : 0, address(item.selection.address)];
  return [item.binding.path, address(item.address), selection, item.kind === 'implementation' ? 1 : 0, item.operation, item.encodingVersion, [item.encoded], item.fingerprint];
}

/** @internal Independently specified ordered cold tuple expectation. */
export function expectedColdTuple(n: number, digest: string): IColdTuple {
  const plain = coldProvenance(n, digest);
  return { trackingSemantics: 2, semanticVersion: 1, kind: 'source', step: plain.step, observations: plain.observations.map(observation), children: [] };
}
/** @internal Component contributions retain their semantic role, not a fitted row delta. */
export interface ITupleLedger { readonly root: number; readonly prefix: readonly number[]; readonly rows: readonly number[]; readonly rowScaffold: number; readonly fixedScaffold: number }
/** @internal Derive fixed and repeated grammar components without whole-population differences. */
export function tupleLedger(): ITupleLedger {
  const fixture = expectedColdTuple(1, 'a'.repeat(64));
  // The root includes an empty observations array and the MDS1 prefix exactly once.
  const root = snapshotLengths({ ...fixture, observations: [] }).utf16;
  // Each component is counted bottom-up by the independent Value grammar counter.
  // Removing its five-unit prefix leaves the subtree body inserted into the array.
  const components = fixture.observations.map((item) => snapshotLengths(item).utf16 - 5);
  const prefix = components.slice(0, 3); const rows = components.slice(3);
  const sum = (values: readonly number[]): number => values.reduce(exactAdd, 0);
  // Four rows' observations each retain three index widths (12); key/score add
  // two ordinal widths. Four inter-observation commas belong to each row group.
  const rowScaffold = exactAdd(sum(rows), 4) - 14;
  // Three fixed observations contribute two commas; the length fact's sole
  // population digit is removed here and accounted for by d(N) in tupleModel.
  const fixedScaffold = exactAdd(exactAdd(root, sum(prefix)), 2) - 1;
  return { root, prefix, rows, rowScaffold, fixedScaffold };
}
/** @internal Exact arithmetic-only predicted complete MDS1 size for the pinned cold shape. */
export function tupleModel(n: number): number {
  if (!Number.isSafeInteger(n) || n < 1) { throw new Error('invalid population'); }
  const ledger = tupleLedger();
  return exactAdd(exactAdd(exactAdd(ledger.rowScaffold * n, ledger.fixedScaffold), exactAdd(12 * digitSum(0, n - 1), 2 * digitSum(1, n))), String(n).length);
}
/** Exact own-data comparison rejects normalization, order changes and pointer sharing. */
function sameActual(actual: unknown, expected: unknown, depth: number, budget: { nodes: number }): void {
  if (++budget.nodes > 100000 || depth > 64) { throw new Error('tuple node/depth budget'); }
  if (typeof expected !== 'object' || expected === null) { if (!Object.is(actual, expected)) { throw new Error('tuple scalar mismatch'); } return; }
  if (typeof actual !== 'object' || actual === null || Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) { throw new Error('tuple prototype mismatch'); }
  const left = Reflect.ownKeys(actual); const right = Reflect.ownKeys(expected);
  if (left.length !== right.length || left.some((key, position) => key !== right[position])) { throw new Error('tuple own order/slots mismatch'); }
  for (const key of right) {
    const a = Object.getOwnPropertyDescriptor(actual, key); const b = Object.getOwnPropertyDescriptor(expected, key);
    if (a === undefined || b === undefined || !('value' in a) || !('value' in b) || a.enumerable !== b.enumerable) { throw new Error('tuple data surface mismatch'); }
    const av: unknown = a.value; const bv: unknown = b.value; sameActual(av, bv, depth + 1, budget);
  }
}
/** @internal Pin actual owner output before independently measuring it with generated Value. */
export function measureActualTuple(actual: unknown, n: number, digest: string): { readonly utf16: number; readonly utf8: number; readonly canonicalSha256: string } {
  sameActual(actual, expectedColdTuple(n, digest), 0, { nodes: 0 });
  const independent = snapshotLengths(actual);
  if (independent.utf16 > 1048576 || independent.utf8 > 1048576) { throw new Error('canonical budget'); }
  // The actual owner-produced value, not the reconstructed expectation, enters Value.
  const canonical = encodeSnapshot(actual);
  if (canonical.length !== independent.utf16 || Buffer.byteLength(canonical) !== independent.utf8 || canonical.length !== tupleModel(n)) { throw new Error('independent tuple accounting mismatch'); }
  return { ...independent, canonicalSha256: createHash('sha256').update(canonical).digest('hex') };
}
/** @internal Require strict capacity for both the JSON body and complete transport. */
export function tupleCapacity(n: number, maximum: number): { readonly body: number; readonly canonical: number; readonly bodyMargin: number; readonly canonicalMargin: number } {
  if (!Number.isSafeInteger(maximum) || maximum < 1) { throw new Error('invalid maximum'); }
  const canonical = tupleModel(n); const body = canonical - 5;
  if (body >= maximum || canonical >= maximum) { throw new Error('tuple does not fit strictly below actual Node maximum'); }
  return { body, canonical, bodyMargin: maximum - body, canonicalMargin: maximum - canonical };
}
/** @internal One mathematical row, allowing decimal boundaries without a larger population. */
export function isolatedRow(index: number): readonly unknown[] {
  if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(index + 1)) { throw new Error('invalid isolated index'); }
  const row: readonly IAddressSegment[] = [{ kind: 'property', key: 'rows' }, { kind: 'index', index }];
  const fact = (segments: readonly IAddressSegment[], operation: IOperation, scalar: string | number): readonly unknown[] => {
    const encoded = encodeSelectedFact({ operation, address: segments, fact: scalar });
    return [['inputs'], address(segments), [0, operation === 'container-kind' ? 5 : 0, address(segments)], 0, operation, 'MDO1', [encoded], createHash('sha256').update(encoded).digest('hex')];
  };
  return [fact(row, 'container-kind', 'record'), fact([...row, { kind: 'property', key: 'key' }], 'value', `acme/widget#${String(index + 1)}`),
    fact([...row, { kind: 'property', key: 'score' }], 'value', index + 1), fact([...row, { kind: 'property', key: 'unread' }], 'value', 'baseline')];
}
