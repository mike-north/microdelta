/** Parametric accounting uses fixed tiny scaffolds and decimal groups, never a full population. @packageDocumentation */
import { coldProvenance } from './guards.js';
import { digitSum, exactAdd, snapshotLengths } from './length.js';

/** Fixed implementation hashes vary in value but never in ASCII width or escaping. */
const implementationDigest = 'a'.repeat(64);
/** One- and two-row controls establish fixed scaffolding independently of retained cell lengths. */
const one = snapshotLengths(coldProvenance(1, implementationDigest)).utf16;
const two = snapshotLengths(coldProvenance(2, implementationDigest)).utf16;
/** A accounts for four per-row observations and delimiters, excluding variable digits. */
export const rowScaffold = two - one - 14;
/** B accounts for fixed root/step/implementation/array/length-fact scaffolding, excluding d(N). */
export const fixedScaffold = one - rowScaffold - 15;

/**
 * @internal Exact conditional cold-listing MDS1 UTF-16 length for the pinned source shape.
 * Four row observations repeat each index in address, selection and encoded fact (12);
 * key and score each include the one-based ordinal (2). The length fact includes d(N).
 * All selected cold facts are ASCII; this does not generalize to arbitrary Unicode inputs.
 */
export function canonicalModel(n: number): number {
  if (!Number.isSafeInteger(n) || n < 1) { throw new Error('invalid population'); }
  return exactAdd(exactAdd(exactAdd(rowScaffold * n, fixedScaffold), exactAdd(12 * digitSum(0, n - 1), 2 * digitSum(1, n))), String(n).length);
}
