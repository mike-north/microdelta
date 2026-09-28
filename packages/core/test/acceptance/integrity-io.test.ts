/**
 * M3 acceptance, A-10 exact references and the selected read path through
 * independent processes over the real SQLite backend. Superseded exact
 * results stay readable at their references; a missing reference, a
 * reference from another store and a reference with a wrong scope fail
 * without retargeting or recomputation; an author's attempt to mutate the
 * eligible previous result changes no stored data. Read evidence comes from
 * the production statements themselves (their role tags and the payload cells
 * they return), observed in the worker process: nested selected reads touch
 * only consumed scalar leaves, and eligible cache validation reads metadata
 * and fingerprints only, never a root payload.
 *
 * @see ../../../../docs/spec/acceptance.md (A-10, A-17)
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Nested materialization and evidence ownership)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { adaExpected, benExpected } from './expected.js';
import { baseWorld, outcomeOf, referenceOf, scenario } from './harness.js';
import type { IProcessRun, IScenario } from './harness.js';

let s: IScenario;
let cold: IProcessRun;

beforeEach(() => {
  s = scenario();
  s.writeWorld(baseWorld());
  cold = s.run({ kind: 'report' }, { keys: s.saveKeys('cold').file });
});

afterEach(() => {
  s.remove();
});

/** Replace the numeric result identity inside an exact locator. */
function withResultId(locator: string, id: number): string {
  return locator.replace(/,(\d+)\]$/u, `,${String(id)}]`);
}

/** Production-statement read evidence for one window. */
interface IWindowReads {
  readonly roles: Readonly<Record<string, number>>;
  readonly rootPayloadCells: number;
  readonly scalarCells: number;
  readonly stagedCells: number;
}

/** The read evidence of a report run's validation window. */
function validationReads(run: IProcessRun): IWindowReads {
  const reads = run.result?.['reads'] as { readonly validation: IWindowReads } | undefined;
  if (reads === undefined) {
    throw new Error('no read evidence');
  }
  return reads.validation;
}

describe('exact-reference-integrity (A-10)', () => {
  test('a superseded summary stays exactly readable beside its successor', () => {
    s.writeWorld({ ...baseWorld(), pullRequests: baseWorld().pullRequests.map((pull) => (pull.number === 103 ? { ...pull, merged: true } : pull)), final: { 'person:ada': false, 'person:ben': true } });
    const next = s.run({ kind: 'report' }, { keys: s.saveKeys('merged').file });
    const read = s.run({ kind: 'read', locators: [referenceOf(cold, 'person:ada'), referenceOf(next, 'person:ada')] });
    expect(read.result?.['reads']).toEqual([
      { locator: referenceOf(cold, 'person:ada'), data: { name: 'Ada', authored: 3, merged: 2, reviews: 5, sentence: adaExpected.sentence } },
      { locator: referenceOf(next, 'person:ada'), data: { name: 'Ada', authored: 3, merged: 3, reviews: 5, sentence: 'Ada authored 3 pull requests, 3 of which were merged, and submitted 5 reviews.' } },
    ]);
  });

  test('a missing reference, a reference from another store and a wrong-scope reference fail without retargeting or recomputation', () => {
    const other = scenario();
    try {
      other.writeWorld(baseWorld());
      // A genuinely different logical store: identity, not file location, defines a store.
      const foreign = other.run({ kind: 'report' }, { keys: other.saveKeys('other').file, logicalStore: 'store:m3-other' });
      const ada = referenceOf(cold, 'person:ada');
      const wrongScope = ada.replace('"env:acceptance"', '"env:other"');
      const read = s.run({ kind: 'read', locators: [withResultId(ada, 9_999), referenceOf(foreign, 'person:ada'), wrongScope] });
      const reads = read.result?.['reads'] as readonly Readonly<Record<string, unknown>>[];
      expect(reads.map((entry) => ('data' in entry ? 'read' : 'failed'))).toEqual(['failed', 'failed', 'failed']);
      expect(read.count('summary') + read.count('check') + read.count('finality')).toBe(0);
      // The other store's reference names its own logical store; it is never resolved against this one.
      expect(referenceOf(foreign, 'person:ada')).toContain('"store:m3-other"');
    } finally {
      other.remove();
    }
  });

  test('an author mutating the eligible previous result changes no stored data', () => {
    s.writeWorld({ ...baseWorld(), check: { 'person:ada': 'mutate-previous', 'person:ben': 'fresh' }, final: { 'person:ada': false, 'person:ben': true } });
    const next = s.run({ kind: 'report' }, { keys: s.saveKeys('mutate').file });
    const attempt = next.lines.find((line) => line['helper'] === 'mutate-previous');
    expect(attempt).toMatchObject({ mutated: false, nameAfter: 'Ada' });
    const coldSource = s.inspect((history) => history.readEnvelope({ kind: 'completed-result', locator: referenceOf(cold, 'person:ada') }).dependencies[0]);
    s.inspect((history) => {
      expect(coldSource === undefined ? undefined : history.reader.readSubtree(coldSource, [{ kind: 'property', key: 'profile' }])).toEqual({ id: 'gh:1001', name: 'Ada', avatarUrl: 'https://avatars.example/ada.png' });
    });
    expect(next.result?.['report']).toEqual([adaExpected, benExpected]);
  });
});

describe('selected-node-io (A-17 within M3)', () => {
  test('cold summary bodies read only the consumed scalar leaves of their source results, never a root payload', () => {
    // Hand-derived consumed leaves: Ada reads profile.name and three merged flags (4); Ben profile.name and two (3).
    const reads = validationReads(cold);
    expect(reads.rootPayloadCells).toBe(0);
    expect(reads.scalarCells).toBe(7);
    expect(reads.roles['subtree-payload']).toBeUndefined();
  });

  test('fingerprint-only validation: with accepting hooks that never read the previous result, restart validation reads zero payload', () => {
    // Its own store, so both processes declare the same hooks that decide from
    // current inputs and the external world only.
    const blind = scenario();
    try {
      blind.writeWorld(baseWorld());
      const coldBlind = blind.run({ kind: 'report' }, { keys: blind.saveKeys('cold').file, variation: { blindFinality: true } });
      const coldSources = blind.inspect((history) => Object.fromEntries((['person:ada', 'person:ben'] as const).map((member) =>
        [member, history.readEnvelope({ kind: 'completed-result', locator: referenceOf(coldBlind, member) }).dependencies.map((reference) => reference.locator)])));
      const restart = blind.run({ kind: 'report' }, { keys: blind.saveKeys('restart').file, variation: { blindFinality: true } });
      for (const member of ['person:ada', 'person:ben'] as const) {
        expect(restart.count('finality-blind', member)).toBe(1);
        expect(restart.count('check', member)).toBe(0);
        expect(restart.count('summary', member)).toBe(0);
        expect(outcomeOf(restart, member)).toMatchObject({ kind: 'reused', basis: 'validated', reference: referenceOf(coldBlind, member), accepted: coldSources[member] });
      }
      const reads = validationReads(restart);
      // The whole validation window returned no author payload of any kind…
      expect({ root: reads.rootPayloadCells, scalar: reads.scalarCells, staged: reads.stagedCells }).toEqual({ root: 0, scalar: 0, staged: 0 });
      expect(reads.roles['leaf-payload'] ?? 0).toBe(0);
      expect(reads.roles['subtree-payload'] ?? 0).toBe(0);
      // …while the consumed child facts were compared through stored fingerprints.
      expect(reads.roles['fingerprint'] ?? 0).toBeGreaterThan(0);
    } finally {
      blind.remove();
    }
  });

  test('eligible restart validation is metadata-only: no source payload beyond the finality hooks\' own selected reads', () => {
    const restart = s.run({ kind: 'report' }, { keys: s.saveKeys('restart').file });
    expect(outcomeOf(restart, 'person:ada')['kind']).toBe('reused');
    const reads = validationReads(restart);
    expect(reads.rootPayloadCells).toBe(0);
    expect(reads.roles['subtree-payload']).toBeUndefined();
    // Each current finality hook reads previous.data.profile.id: one selected leaf per member, nothing else.
    expect(reads.scalarCells).toBe(2);
    expect(reads.roles['allocate']).toBeUndefined();
  });

  test('a consumed change reads only the re-executed summary\'s consumed leaves; the unaffected member validates by metadata', () => {
    s.writeWorld({ ...baseWorld(), pullRequests: baseWorld().pullRequests.map((pull) => (pull.number === 103 ? { ...pull, merged: true } : pull)), final: { 'person:ada': false, 'person:ben': true } });
    const next = s.run({ kind: 'report' }, { keys: s.saveKeys('merged').file });
    expect(outcomeOf(next, 'person:ada')['kind']).toBe('published');
    const reads = validationReads(next);
    expect(reads.rootPayloadCells).toBe(0);
    // Ada's re-executed body reads 4 leaves of the new source; Ben's finality hook reads 1; Ada's hook does too (answering false).
    expect(reads.scalarCells).toBe(6);
  });
});
