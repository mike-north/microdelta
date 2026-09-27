/**
 * EXP-6 compares an independently generated Lean corpus with EXP-2's selected
 * TypeScript facts. This optional suite requires a pinned Lean binary and does
 * not make Lean a prerequisite for unrelated repository checks.
 */
import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';

import {
  decodeSnapshot,
  decodeValue,
  encodeObservation,
  encodeSnapshot,
  encodeValue,
  observe,
} from '../../exp-2/src/value.js';

/** Oracle atom tags travel as data, never through JavaScript truthiness. */
type IAtomToken =
  | { readonly kind: 'undefined' }
  | { readonly kind: 'null' }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'number'; readonly value: string };

/** A fixture entry retains its UTF-16 key units and selected atom. */
interface IEntryToken {
  readonly key: string;
  readonly value: IAtomToken;
}

/** One case names source order, independent sorted order, and expected facts. */
interface IOracleCase {
  readonly entries: readonly IEntryToken[];
  readonly normal: readonly IEntryToken[];
  readonly key: string;
  readonly value: IAtomToken;
  readonly own: boolean;
}

/** Decode a property name from explicit UTF-16 code units, including lone surrogates. */
function parseKey(raw: unknown): string {
  if (!Array.isArray(raw)) {
    throw new TypeError('Oracle key must be code units');
  }
  const parts: readonly unknown[] = raw;
  const units: number[] = [];
  for (const part of parts) {
    if (typeof part !== 'number' || !Number.isInteger(part) || part < 0 || part > 0xffff) {
      throw new TypeError('Oracle key has an invalid UTF-16 code unit');
    }
    units.push(part);
  }
  return String.fromCharCode(...units);
}

/** Validate the small oracle atom vocabulary before it crosses into JS values. */
function parseAtom(raw: unknown): IAtomToken {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !('kind' in raw)) {
    throw new TypeError('Oracle atom must be tagged');
  }
  switch (raw.kind) {
    case 'undefined':
    case 'null':
      return { kind: raw.kind };
    case 'boolean':
      if ('value' in raw && typeof raw.value === 'boolean') {
        return { kind: raw.kind, value: raw.value };
      }
      break;
    case 'text':
      if ('value' in raw && typeof raw.value === 'string' && hasOnlyUnicodeScalars(raw.value)) {
        return { kind: raw.kind, value: raw.value };
      }
      break;
    case 'number':
      if ('value' in raw && typeof raw.value === 'string') {
        return { kind: raw.kind, value: raw.value };
      }
      break;
    default:
      break;
  }
  throw new TypeError('Oracle atom has an unsupported payload');
}

/** Lean String cannot express an unpaired UTF-16 surrogate as an atom value. */
function hasOnlyUnicodeScalars(value: string): boolean {
  for (const scalar of value) {
    const point = scalar.codePointAt(0);
    if (point === undefined || (point >= 0xd800 && point <= 0xdfff)) {
      return false;
    }
  }
  return true;
}

/** Validate entry shapes before the record builder enforces key uniqueness. */
function parseEntries(raw: unknown): readonly IEntryToken[] {
  if (!Array.isArray(raw)) {
    throw new TypeError('Oracle record must be an entry list');
  }
  const parts: readonly unknown[] = raw;
  return parts.map(part => {
    if (!Array.isArray(part) || part.length !== 2) {
      throw new TypeError('Oracle entry must be a key and atom pair');
    }
    const pair: readonly unknown[] = part;
    return { key: parseKey(pair[0]), value: parseAtom(pair[1]) };
  });
}

/** A case carries expected facts directly from Lean's evaluator. */
function parseCase(raw: unknown): IOracleCase {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)
    || !('entries' in raw) || !('normal' in raw) || !('key' in raw)
    || !('value' in raw) || !('own' in raw) || typeof raw.own !== 'boolean') {
    throw new TypeError('Oracle case is malformed');
  }
  return {
    entries: parseEntries(raw.entries),
    normal: parseEntries(raw.normal),
    key: parseKey(raw.key),
    value: parseAtom(raw.value),
    own: raw.own,
  };
}

/** The checker must prove its theorem before cases are admitted as an oracle. */
function loadCases(): readonly IOracleCase[] {
  const lean = process.env['EXP6_LEAN'];
  if (!lean) {
    throw new TypeError('Set EXP6_LEAN to the pinned Lean 4.34.1 binary');
  }
  const version = execFileSync(lean, ['--version'], { encoding: 'utf8' });
  if (!version.startsWith('Lean (version 4.34.1,')) {
    throw new TypeError('The EXP-6 oracle requires pinned Lean 4.34.1');
  }
  const output = execFileSync(lean, ['--run', 'experiments/exp-6/FlatRecord.lean'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!output.includes("'Exp6.equal_normal_form_preserves_property_reads' depends on axioms: [propext, Classical.choice, Quot.sound]")) {
    throw new TypeError('Lean proof assumptions changed or were not reported');
  }
  const cases: IOracleCase[] = [];
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith('CASE ')) {
      const raw: unknown = JSON.parse(line.slice('CASE '.length));
      cases.push(parseCase(raw));
    }
  }
  return cases;
}

/** Construct null-prototype own data independently of EXP-2's record helper. */
function makeRecord(entries: readonly IEntryToken[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  Object.setPrototypeOf(record, null);
  const keys = new Set<string>();
  for (const entry of entries) {
    if (keys.has(entry.key)) {
      throw new TypeError(`Duplicate oracle key ${entry.key}`);
    }
    keys.add(entry.key);
    Object.defineProperty(record, entry.key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: atomValue(entry.value),
    });
  }
  return record;
}

/** Convert only the selected generated atom tokens; others fail closed. */
function atomValue(atom: IAtomToken): unknown {
  switch (atom.kind) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'boolean':
    case 'text': return atom.value;
    case 'number':
      switch (atom.value) {
        case '0': return 0;
        case '-0': return -0;
        case '1': return 1;
        case '2': return 2;
        default: throw new TypeError(`Unsupported oracle number token ${atom.value}`);
      }
    default: throw new TypeError('Unsupported oracle atom');
  }
}

describe('EXP-6 bounded differential oracle', () => {
  test('generated Lean facts agree with direct TypeScript property observations', () => {
    const cases = loadCases();
    expect(cases).toHaveLength(2285);
    for (const sample of cases) {
      const source = makeRecord(sample.entries);
      const normalized = makeRecord(sample.normal);
      const path = [{ kind: 'property', key: sample.key }] as const;
      expect(Object.is(observe(source, path, 'value').fact, atomValue(sample.value))).toBe(true);
      expect(observe(source, path, 'own').fact).toBe(sample.own);
      expect(encodeValue(source)).toBe(encodeValue(normalized));
      const decoded = decodeValue(encodeValue(source));
      expect(Object.is(observe(decoded, path, 'value').fact, atomValue(sample.value))).toBe(true);
      expect(observe(decoded, path, 'own').fact).toBe(sample.own);
    }
  });

  test('key enumeration remains outside unordered normal-form equality', () => {
    const reverse = makeRecord([
      { key: 'b', value: { kind: 'number', value: '2' } },
      { key: 'a', value: { kind: 'number', value: '1' } },
    ]);
    const forward = makeRecord([
      { key: 'a', value: { kind: 'number', value: '1' } },
      { key: 'b', value: { kind: 'number', value: '2' } },
    ]);
    expect(encodeValue(reverse)).toBe(encodeValue(forward));
    expect(encodeObservation(observe(reverse, [], 'keys')))
      .not.toBe(encodeObservation(observe(forward, [], 'keys')));
    expect(observe(decodeSnapshot(encodeSnapshot(reverse)), [], 'keys').fact).toEqual(['b', 'a']);
  });

  test('unsupported translations reject duplicates and accessors', () => {
    expect(() => makeRecord([
      { key: 'x', value: { kind: 'undefined' } },
      { key: 'x', value: { kind: 'null' } },
    ])).toThrow(/duplicate/i);
    const getterRecord: Record<string, unknown> = {};
    Object.setPrototypeOf(getterRecord, null);
    Object.defineProperty(getterRecord, 'x', {
      enumerable: true,
      get(): number { return 1; },
    });
    expect(() => encodeValue(getterRecord)).toThrow(/accessor/i);
    expect(() => parseAtom({ kind: 'text', value: '\ud800' })).toThrow(/unsupported/i);
  });
});
