/**
 * Outcome tests for keying a collection snapshot: designated identity and
 * custom keys, canonical key order, order independence, prototype-named keys,
 * and whole-snapshot rejection with diagnostics that name the collection, the
 * key and the custom-key option. Keying precedes any gate or member body and
 * never invokes one.
 *
 * @see ../../../docs/spec/tracking.md (COL-1, COL-3, COL-4)
 * @see ../../../docs/spec/composition.md (EXP-4 template selection)
 * @see ../../../docs/plans/m4-composition.md (Concrete fixture decisions: designated identity, custom key)
 * @see ../../../docs/spec/acceptance.md (A-07)
 */
import { describe, expect, jest, test } from '@jest/globals';

import type { IKeyedSnapshot, IKeyingDiagnostic, IMemberBuilder } from '../src/index.js';
import { expectDefinitionError } from './fixtures/assertions.js';
import type { ITestFamily } from './fixtures/contributors.js';
import { ada, ben, buildKeyed, compose, cy, keyedScope, source, template, type IContributors } from './fixtures/keyed.js';

/** The keyed members of a successful keying, failing the test otherwise. */
function keyed(result: IKeyedSnapshot): Extract<IKeyedSnapshot, { readonly status: 'keyed' }> {
  if (result.status !== 'keyed') {
    throw new Error(`expected keyed members, got ${JSON.stringify(result)}`);
  }
  return result;
}

/** The diagnostic of a rejected keying, failing the test otherwise. */
function rejected(result: IKeyedSnapshot): IKeyingDiagnostic {
  if (result.status !== 'rejected') {
    throw new Error(`expected a rejection, got ${JSON.stringify(result)}`);
  }
  return result.diagnostic;
}

/** Keys of a successful keying, in the returned order. */
function keysOf(result: IKeyedSnapshot): readonly string[] {
  return keyed(result).members.map(entry => entry.key);
}

describe('keying by designated identity (COL-1)', () => {
  test('COL-1: every member is keyed by its designated identity, in canonical order, with completion passed through', () => {
    const { composition } = buildKeyed();
    const result = composition.keyMembers('contributor', { members: [cy, ada, ben], status: 'open' });
    expect(result).toEqual({
      status: 'keyed',
      template: 'contributor',
      collection: 'contributors',
      completion: 'open',
      members: [
        { key: 'person:ada', member: ada },
        { key: 'person:ben', member: ben },
        { key: 'person:cy', member: cy },
      ],
    });
    const members = keyed(result).members;
    expect(members[0]?.member).toBe(ada);
    expect(members[2]?.member).toBe(cy);
  });

  test('COL-3: array position is never identity; every permutation keys each record to its own key', () => {
    const { composition } = buildKeyed();
    const orders = [[ada, ben, cy], [cy, ben, ada], [ben, cy, ada]];
    const results = orders.map(members => composition.keyMembers('contributor', { members, status: 'complete' }));
    for (const result of results) {
      expect(result).toEqual(results[0]);
      expect(keyed(result).members.find(entry => entry.key === 'person:ben')?.member).toBe(ben);
    }
  });

  test('COL-1: keys are returned in canonical code-unit order', () => {
    const { composition } = buildKeyed();
    const members = ['b', 'B', 'a', '_', 'Z', '10', '9'].map(key => ({ key }));
    expect(keysOf(composition.keyMembers('contributor', { members, status: 'complete' }))).toEqual(['10', '9', 'B', 'Z', '_', 'a', 'b']);
  });

  test('COL-1: canonical order is UTF-16 code-unit order, not code point or locale order', () => {
    const { composition } = buildKeyed();
    // U+1F600 is encoded as the surrogate pair D83D DE00, which sorts before U+FF61 by code
    // unit even though its code point is larger; a locale or code point order would differ.
    const members = ['\uFF61', '\u{1F600}', 'z', '\u00E9'].map(key => ({ key }));
    expect(keysOf(composition.keyMembers('contributor', { members, status: 'complete' }))).toEqual(['z', '\u00E9', '\u{1F600}', '\uFF61']);
  });

  test('COL-1: prototype-named keys are ordinary keys, including duplicate detection', () => {
    const { composition } = buildKeyed();
    const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
    const members = names.map(key => ({ key }));
    expect(keysOf(composition.keyMembers('contributor', { members, status: 'complete' }))).toEqual([...names].sort());
    const duplicate = rejected(composition.keyMembers('contributor', { members: [{ key: '__proto__' }, { key: '__proto__' }], status: 'complete' }));
    expect(duplicate).toMatchObject({ reason: 'duplicate-key', key: '__proto__' });
    // A parsed record may carry an own `__proto__` data property; identity is
    // still read from the record's own `key` field, never through its prototype.
    const parsed: unknown = JSON.parse('{"key": "person:ada", "__proto__": {"key": "person:intruder"}}');
    expect(keysOf(composition.keyMembers('contributor', { members: [parsed], status: 'complete' }))).toEqual(['person:ada']);
  });

  test('COL-1: a closed empty collection keys to no members; an open one keeps its status', () => {
    const { composition } = buildKeyed();
    expect(composition.keyMembers('contributor', { members: [], status: 'complete' })).toMatchObject({ status: 'keyed', completion: 'complete', members: [] });
    expect(composition.keyMembers('contributor', { members: [], status: 'open' })).toMatchObject({ status: 'keyed', completion: 'open', members: [] });
  });

  test('COL-1: the keyed result is frozen', () => {
    const { composition } = buildKeyed();
    const result = keyed(composition.keyMembers('contributor', { members: [ada, ben], status: 'complete' }));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.members)).toBe(true);
    expect(result.members.every(entry => Object.isFrozen(entry))).toBe(true);
  });
});

describe('keying by custom key (COL-1)', () => {
  test('COL-1: an explicit custom key overrides designated identity, even when that field is absent', () => {
    const built = buildKeyed({ customKey: true });
    const anonymous = { id: 'gh:1004', login: 'dee', authored: 1 };
    const result = built.composition.keyMembers('contributor', { members: [cy, anonymous, ada], status: 'complete' });
    expect(keysOf(result)).toEqual(['gh:1001', 'gh:1003', 'gh:1004']);
    expect(keyed(result).members.find(entry => entry.key === 'gh:1004')?.member).toBe(anonymous);
    expect(built.calls.key).toBe(3);
  });

  test('COL-1: keys are scoped per template: two templates over one collection key it independently', () => {
    const collection = source<IContributors>({ subject: 'shared', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
    const steps = (prefix: string) => (member: IMemberBuilder<ITestFamily>) => ({ p: member.source<string>({ subject: member.subject(prefix), run: () => 'p' }) });
    const byIdentity = template({ slot: 'by-identity', collection, steps: steps('identity') });
    const byLogin = template({ slot: 'by-login', collection, key: (member) => member.login, steps: steps('login') });
    const composition = compose({ scope: keyedScope, steps: [{ slot: 'c', declaration: collection }], templates: [byLogin, byIdentity] });
    const snapshot = { members: [ada, ben], status: 'complete' };
    expect(keysOf(composition.keyMembers('by-identity', snapshot))).toEqual(['person:ada', 'person:ben']);
    expect(keysOf(composition.keyMembers('by-login', snapshot))).toEqual(['ada', 'ben']);
  });

  test('COL-1: a custom key that is missing, non-string, empty or throwing rejects the whole snapshot', () => {
    // Snapshot data is untrusted at runtime: the custom key reads `login`,
    // which these records omit or mistype despite the declared member type.
    const collection = source<IContributors>({ subject: 'c:custom', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
    const byLogin = template({ slot: 'by-login', collection, key: (member) => member.login, steps: (member) => ({ p: member.source<string>({ subject: member.subject('login'), run: () => 'p' }) }) });
    const byUpper = template({ slot: 'by-upper', collection, key: (member) => member.login.toUpperCase(), steps: (member) => ({ p: member.source<string>({ subject: member.subject('upper'), run: () => 'p' }) }) });
    const composition = compose({ scope: keyedScope, steps: [{ slot: 'roster', declaration: collection }], templates: [byLogin, byUpper] });
    const cases: readonly [string, unknown, IKeyingDiagnostic['reason']][] = [
      ['by-login', { id: 'gh:1' }, 'missing-key'],
      ['by-login', { login: 7 }, 'non-string-key'],
      ['by-login', { login: '' }, 'empty-key'],
      ['by-upper', { id: 'gh:1' }, 'key-function-failed'],
    ];
    for (const [slot, member, reason] of cases) {
      const diagnostic = rejected(composition.keyMembers(slot, { members: [ada, member], status: 'complete' }));
      expect(diagnostic).toMatchObject({ reason, template: slot, collection: 'roster', identity: undefined, customKey: true });
      expect(diagnostic.message).toContain('roster');
      expect(diagnostic.message).toContain('`key` option');
    }
  });
});

describe('keying rejections (COL-1)', () => {
  test('COL-1: a custom key that throws a value with no string form still rejects the snapshot, never escaping', () => {
    const collection = source<IContributors>({ subject: 'c:unprintable', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
    const thrown: unknown[] = [Object.create(null), Symbol('bad'), { toString: () => { throw new Error('toString failed'); } }];
    const composition = compose({
      scope: keyedScope,
      steps: [{ slot: 'roster', declaration: collection }],
      templates: thrown.map((value, index) => template({
        slot: `unprintable-${String(index)}`,
        collection,
        key: () => {
          throw value;
        },
        steps: (member) => ({ p: member.source<string>({ subject: member.subject(`unprintable-${String(index)}`), run: () => 'p' }) }),
      })),
    });
    thrown.forEach((_value, index) => {
      const diagnostic = rejected(composition.keyMembers(`unprintable-${String(index)}`, { members: [ada], status: 'complete' }));
      expect(diagnostic).toMatchObject({ reason: 'key-function-failed', collection: 'roster', customKey: true });
      expect(diagnostic.message).toContain('`key` option');
    });
  });

  test('COL-1, RUN-013: a custom key that throws rejects the snapshot with a diagnostic that never repeats the thrown text', () => {
    const collection = source<IContributors>({ subject: 'c:secret', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
    const composition = compose({
      scope: keyedScope,
      steps: [{ slot: 'roster', declaration: collection }],
      templates: [template({
        slot: 'by-secret',
        collection,
        key: () => {
          throw new Error('key lookup failed AUTHOR-SECRET-7e57');
        },
        steps: (member) => ({ p: member.source<string>({ subject: member.subject('secret'), run: () => 'p' }) }),
      })],
    });
    const diagnostic = rejected(composition.keyMembers('by-secret', { members: [ada], status: 'complete' }));
    expect(diagnostic).toMatchObject({ reason: 'key-function-failed', collection: 'roster', customKey: true });
    expect(diagnostic.message).toContain('custom key threw');
    expect(diagnostic.message).not.toContain('AUTHOR-SECRET-7e57');
  });

  test('COL-1: a duplicate key rejects the whole snapshot, naming the collection, the key and the custom-key option', () => {
    const { composition } = buildKeyed();
    const result = composition.keyMembers('contributor', { members: [ada, ben, { ...ada, login: 'ada-2' }], status: 'complete' });
    expect(Object.keys(result).sort()).toEqual(['diagnostic', 'status']);
    const diagnostic = rejected(result);
    expect(diagnostic).toMatchObject({ reason: 'duplicate-key', template: 'contributor', collection: 'contributors', key: 'person:ada', identity: 'key', customKey: false });
    expect(diagnostic.message).toContain('contributors');
    expect(diagnostic.message).toContain('"person:ada"');
    expect(diagnostic.message).toContain('`key` option');
    expect(Object.isFrozen(diagnostic)).toBe(true);
  });

  test('COL-1: a duplicate custom key names the custom key rather than the designated identity', () => {
    const { composition } = buildKeyed({ customKey: true });
    const diagnostic = rejected(composition.keyMembers('contributor', { members: [ada, { ...ben, id: ada.id }], status: 'complete' }));
    expect(diagnostic).toMatchObject({ reason: 'duplicate-key', key: 'gh:1001', identity: undefined, customKey: true });
  });

  test('COL-1: a member without its designated identity rejects the snapshot and points to the custom-key option', () => {
    const { composition } = buildKeyed();
    const anonymous = { id: 'gh:1004', login: 'dee', authored: 1 };
    const diagnostic = rejected(composition.keyMembers('contributor', { members: [ada, anonymous], status: 'complete' }));
    expect(diagnostic).toMatchObject({ reason: 'missing-key', collection: 'contributors', key: undefined, identity: 'key', customKey: false });
    expect(diagnostic.message).toContain('contributors');
    expect(diagnostic.message).toContain('"key"');
    expect(diagnostic.message).toContain('`key` option');
  });

  test('COL-1: identity must be an own data field; inherited fields and accessors have none', () => {
    const { composition } = buildKeyed();
    const getter = jest.fn((): string => 'person:getter');
    const cases: readonly unknown[] = [
      Object.create({ key: 'person:inherited' }),
      Object.defineProperty({}, 'key', { get: getter, enumerable: true }),
      { key: undefined },
      {},
    ];
    for (const member of cases) {
      expect(rejected(composition.keyMembers('contributor', { members: [ada, member], status: 'complete' }))).toMatchObject({ reason: 'missing-key' });
    }
    expect(getter).not.toHaveBeenCalled();
  });

  test('COL-1: a non-string or empty designated identity rejects the snapshot', () => {
    const { composition } = buildKeyed();
    for (const key of [17, null, true, {}, ['person:ada']]) {
      expect(rejected(composition.keyMembers('contributor', { members: [{ key }], status: 'complete' }))).toMatchObject({ reason: 'non-string-key', key: undefined });
    }
    expect(rejected(composition.keyMembers('contributor', { members: [{ key: '' }], status: 'complete' }))).toMatchObject({ reason: 'empty-key', key: '' });
  });

  test('COL-1: a hole, null or non-record member makes the snapshot malformed before any key function runs', () => {
    const designated = buildKeyed();
    const custom = buildKeyed({ customKey: true });
    const sparse: unknown[] = [ada];
    sparse[2] = ben;
    const accessorElement: unknown[] = [ada];
    Object.defineProperty(accessorElement, 1, { get: () => ben, enumerable: true });
    const cases: readonly (readonly unknown[])[] = [sparse, [ada, null], [ada, undefined], [ada, 'person:string'], [ada, 7], [ada, ['person:ada']], accessorElement];
    for (const members of cases) {
      for (const built of [designated, custom]) {
        expect(rejected(built.composition.keyMembers('contributor', { members, status: 'complete' }))).toMatchObject({ reason: 'malformed-snapshot', collection: 'contributors' });
      }
    }
    // The custom key never ran: a malformed snapshot is rejected before any author key function.
    expect(custom.calls.key).toBe(0);
  });

  test('COL-1: a rejection is deterministic regardless of discovery order', () => {
    const { composition } = buildKeyed();
    /** Every ordering of a small list. */
    const permutations = <T>(items: readonly T[]): (readonly T[])[] => items.length <= 1 ? [items]
      : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]));
    const scenarios: readonly [readonly unknown[], Readonly<Record<string, unknown>>][] = [
      // Two duplicated keys: the least duplicate key is reported.
      [[{ key: 'b' }, { key: 'b' }, { key: 'a' }, { key: 'a' }], { reason: 'duplicate-key', key: 'a' }],
      // A missing identity outranks duplicates and empty keys, whatever comes first.
      [[{ key: 'b' }, { key: 'b' }, { key: '' }, {}], { reason: 'missing-key', key: undefined }],
      // Non-string keys of different types: the least type name is reported.
      [[{ key: 7 }, { key: true }, { key: 'x' }], { reason: 'non-string-key', message: expect.stringContaining('is boolean') }],
    ];
    for (const [members, expected] of scenarios) {
      const diagnostics = permutations(members).map(order => rejected(composition.keyMembers('contributor', { members: order, status: 'complete' })));
      for (const diagnostic of diagnostics) {
        expect(diagnostic).toEqual(diagnostics[0]);
        expect(diagnostic).toMatchObject(expected);
      }
    }
  });

  test('COL-1: a malformed snapshot is rejected without running getters', () => {
    const { composition } = buildKeyed();
    const getter = jest.fn((): unknown => [ada]);
    const cases: readonly unknown[] = [
      undefined,
      null,
      'snapshot',
      [ada],
      { members: 'ada', status: 'complete' },
      { members: [ada] },
      { members: [ada], status: 'closed' },
      { status: 'complete' },
      Object.defineProperty({ status: 'complete' }, 'members', { get: getter, enumerable: true }),
      Object.create({ members: [ada], status: 'complete' }),
    ];
    for (const snapshot of cases) {
      expect(rejected(composition.keyMembers('contributor', snapshot))).toMatchObject({ reason: 'malformed-snapshot', collection: 'contributors' });
    }
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('keying boundary (CMP-9, A-07)', () => {
  test('A-07: keying runs before, and never invokes, any gate, factory or member body', () => {
    const built = buildKeyed({ gate: true });
    built.composition.keyMembers('contributor', { members: [ada, ben, cy], status: 'complete' });
    rejected(built.composition.keyMembers('contributor', { members: [ada, ada], status: 'complete' }));
    expect(built.calls).toEqual({ gate: 0, key: 0, bodies: 0 });
    expect(built.factoryCalls()).toBe(1);
  });

  test('CMP-9: keying is runtime work and rejects while a composition is being built', () => {
    const { composition } = buildKeyed();
    const collection = source<IContributors>({ subject: 'probe', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
    expectDefinitionError(() => template({
      slot: 'probe',
      collection,
      steps: (member) => {
        composition.keyMembers('contributor', { members: [ada], status: 'complete' });
        return { p: member.source<string>({ subject: member.subject('probe'), run: () => 'p' }) };
      },
    }), 'composition-phase');
  });
});
