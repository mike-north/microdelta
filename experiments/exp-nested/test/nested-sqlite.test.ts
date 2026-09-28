/**
 * Real-SQLite evidence for nested selected reads across independent
 * processes. A publisher process writes immutable results; a fresh reader
 * process reopens the file and reads through the production Tracking and
 * Materialization owners; a third fresh process compares the reader's evidence
 * against current results. Instrumented statements prove which payload cells
 * each operation returned. Expected fingerprints are independent oracles
 * computed here from the original fixture values.
 *
 * @see ../../../docs/spec/tracking.md (TRK-5 observation table, VAL-1/2/3, EXP-2 access decision)
 * @see ../../../docs/spec/domain.md (DOM-3 selected loading)
 * @see ../../../docs/spec/execution.md (RES-002 exact references, RES-003 immutable envelopes)
 * @see ../../../docs/plans/m3-contribution-analysis.md (Nested materialization and evidence ownership)
 * @see ../protocol.md
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import type { ICompletedResultReference } from '@microdelta/history';
import type { ISha256Capability } from '@microdelta/machine';
import { createNodeSqlite } from '@microdelta/machine-node';
import { createTrackingObserver } from '@microdelta/tracking';
import type { ITrackingObserverHost } from '@microdelta/tracking';
import { encodeSelectedFact, encodeSnapshot, fingerprint, observe } from '@microdelta/value';
import type { IAddressSegment, IOperation } from '@microdelta/value';

import { openCandidateNodeIndex } from '../src/node-index.js';
import { activity, publishedResults, unreadNoteBytes } from '../harness/fixtures.js';
import type { ICompareOutput, IReadOutput } from '../harness/worker.js';
import { exerciseDomain, renderEvidence } from '../harness/scenario.js';

/** Independent host hashing for oracles, separate from the workers' Machine adapter. */
const host: ISha256Capability & ITrackingObserverHost = {
  sha256: (input) => createHash('sha256').update(input, 'utf8').digest('hex'),
  createAsyncContext: <T>() => {
    let store: T | undefined;
    return {
      getStore: () => store,
      run: <R>(value: T, callback: () => R): R => {
        const previous = store;
        store = value;
        try { return callback(); } finally { store = previous; }
      },
    };
  },
};

/** Structured Property segment. */
const property = (key: string): IAddressSegment => ({ kind: 'property', key });
/** Structured Index segment. */
const index = (position: number): IAddressSegment => ({ kind: 'index', index: position });

/** MDO1 oracle from the original value. */
function oracle(root: unknown, address: readonly IAddressSegment[], operation: IOperation): string {
  return fingerprint(encodeSelectedFact(observe(root, address, operation)), host);
}

/** Address encoding used by the candidate, rebuilt here to interpret bound request values. */
function encoded(address: readonly IAddressSegment[]): string {
  return JSON.stringify(address.map((segment) => segment.kind === 'property' ? ['p', segment.key] : ['i', segment.index]));
}

/** Every prefix of each address, including the root. */
function prefixesOf(addresses: readonly (readonly IAddressSegment[])[]): ReadonlySet<string> {
  return new Set(addresses.flatMap((address) => address.map((_segment, length) => encoded(address.slice(0, length))).concat(encoded(address))));
}

const logicalStore = 'store:exp-nested';
const workerPath = fileURLToPath(new URL('../harness/worker.js', import.meta.url));
let directory = '';
let databasePath = '';
let references: Readonly<Record<string, string>> = {};
let read: IReadOutput;
let compared: ICompareOutput;

/** Run one worker command in a fresh Node process and parse its single JSON document. */
function runWorker(command: string, input?: unknown): unknown {
  const args = [workerPath, databasePath, logicalStore, command];
  if (input !== undefined) {
    const inputPath = join(directory, `${command}-input.json`);
    writeFileSync(inputPath, JSON.stringify(input));
    args.push(inputPath);
  }
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`worker ${command} failed (${String(result.status)}): ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as unknown;
}

/** Normalize values the way the worker serializes them, so cross-process values compare exactly. */
function serialized(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'number' && !Number.isFinite(item) ? String(item) : item)) as unknown;
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'microdelta-exp-nested-'));
  databasePath = join(directory, 'results.sqlite');
  references = (runWorker('publish') as { readonly references: Readonly<Record<string, string>> }).references;
  read = runWorker('read', { references }) as IReadOutput;
  compared = runWorker('compare', {
    references,
    captures: { summary: read.summary.observations, output: read.output.observations },
  }) as ICompareOutput;
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('nested selected reads over real SQLite in independent processes', () => {
  const base = publishedResults.base;
  const consumedAddresses: readonly (readonly IAddressSegment[])[] = [
    [property('profile'), property('name')],
    [property('pullRequests')],
    [property('pullRequests'), index(0), property('merged')],
    [property('pullRequests'), index(1), property('merged')],
    [property('pullRequests'), index(2), property('merged')],
    [property('reviews')],
  ];

  test('a nested name and indexed loops consume exactly their leaves, matching independent MDO1 oracles', () => {
    // M3 fixture decision: Ada has PRs 101 and 102 merged, 103 open, and five submitted reviews.
    expect(read.summary.value).toEqual({
      name: 'Ada', authored: 3, merged: 2, reviews: 5,
      sentence: 'Ada authored 3 pull requests, 2 of which were merged, and submitted 5 reviews.',
    });
    const expected: readonly (readonly [IOperation, readonly IAddressSegment[]])[] = [
      ['value', [property('profile'), property('name')]],
      ['length', [property('pullRequests')]],
      ['value', [property('pullRequests'), index(0), property('merged')]],
      ['value', [property('pullRequests'), index(1), property('merged')]],
      ['value', [property('pullRequests'), index(2), property('merged')]],
      ['length', [property('reviews')]],
    ];
    expect(read.summary.observations.map((observation) => [observation.operation, observation.address])).toEqual(expected);
    expect(read.summary.observations.map((observation) => observation.fingerprint))
      .toEqual(expected.map(([operation, address]) => oracle(base, address, operation)));
  });

  test('view creation, navigation and selected leaves read no root, sibling or unrelated subtree payload', () => {
    expect(read.creation.payloadCells).toBe(0);
    expect(read.creation.boundAddresses).toEqual([encoded([])]);
    // Exactly the four consumed scalar leaves (name and three merged flags) returned payload.
    expect(read.summary.evidence.payloadCells).toBe(4);
    expect(read.summary.evidence.payloadCharacters).toBeLessThan(200);
    expect(read.summary.evidence.roles['leaf-payload']).toBe(4);
    for (const forbidden of ['root-payload', 'subtree-payload', 'verify']) {
      expect(read.summary.evidence.roles[forbidden]).toBeUndefined();
    }
    const allowed = prefixesOf(consumedAddresses);
    expect(read.summary.evidence.boundAddresses.filter((address) => !allowed.has(address))).toEqual([]);
    // The one-megabyte unread note never crossed the storage boundary.
    expect(unreadNoteBytes).toBeGreaterThan(read.summary.evidence.payloadCharacters * 1000);
  });

  test('explicit output loads only the selected subtree and preserves MDS1 snapshot semantics', () => {
    expect(read.output.value).toEqual({ author: base.profile });
    const author = (read.output.value as { readonly author: object }).author;
    expect(Object.keys(author)).toEqual(['id', 'name', 'avatarUrl']);
    expect(read.output.observations).toHaveLength(1);
    expect(read.output.observations[0]).toMatchObject({
      kind: 'materialized-output',
      address: [property('profile')],
      fingerprint: fingerprint(encodeSnapshot(base.profile), host),
    });
    expect(read.output.evidence.payloadCells).toBe(3);
    expect(read.output.evidence.roles['root-payload']).toBeUndefined();
    expect(read.output.evidence.roles['subtree-payload']).toBe(1);
  });

  test('metadata comparison in a fresh process performs zero payload fallback', () => {
    expect(compared.evidence.statements).toBeGreaterThan(0);
    expect(compared.evidence.payloadCells).toBe(0);
    for (const payloadRole of ['leaf-payload', 'subtree-payload', 'root-payload']) {
      expect(compared.evidence.roles[payloadRole]).toBeUndefined();
    }
    // Positive control: the same instrumentation observes one leaf payload read.
    expect(compared.positiveControl.payloadCells).toBe(1);
    expect(compared.positiveControl.roles['leaf-payload']).toBe(1);
  });

  test('consumed changes invalidate, unread changes retain and container-kind changes never compare equal', () => {
    expect(compared.comparisons.summary).toEqual({
      base: 'equal',
      unreadOnly: 'equal',
      renamed: 'changed',
      mergedChanged: 'changed',
      profileArray: 'incompatible',
      nameRecord: 'changed',
    });
    // Explicit output consumed the whole profile, so an unread avatar is now a consumed change.
    expect(compared.comparisons.output).toEqual({
      base: 'equal',
      unreadOnly: 'changed',
      renamed: 'changed',
      mergedChanged: 'equal',
      profileArray: 'changed',
      nameRecord: 'changed',
    });
  });

  test('supported Value-domain operations over SQLite record the same evidence as in-memory tracked wrappers', () => {
    const observer = createTrackingObserver(host);
    const tracked = observer.tracked(publishedResults.domain, { path: ['domain'] });
    // eslint-disable-next-line microdelta/tracked-captures -- The oracle runs the shared operation table against an in-memory wrapper of the same retained value.
    const inMemory = observer.capture(() => exerciseDomain(observer, tracked));

    expect(read.domain.evidence).toEqual(renderEvidence(inMemory.observations));
    expect(read.domain.value).toEqual(serialized(inMemory.value));
    expect(read.domain.evidence.length).toBeGreaterThan(25);
  });

  test('an old exact reference keeps resolving its own content after later publications', () => {
    expect(read.oldReference.name).toBe('Ada');
    expect(read.oldReference.evidence.payloadCells).toBe(1);
    expect(Object.keys(references)).toEqual(Object.keys(publishedResults));
  });
});

describe('candidate integrity and scope on a real SQLite file', () => {
  /** Open a fresh file-backed candidate in this process. */
  function openFresh(store = 'store:in-process'): { readonly path: string; readonly index: ReturnType<typeof openCandidateNodeIndex>; readonly close: () => void } {
    const path = join(directory, `${store.replace(/[^a-z]/gu, '-')}-${String(Math.random()).slice(2)}.sqlite`);
    const connection = createNodeSqlite().openSqlite(path);
    return { path, index: openCandidateNodeIndex({ connection, sha256: host, logicalStore: store }), close: () => { connection.close(); } };
  }

  test('the index is generated from the canonical payload and detects tampering', () => {
    const opened = openFresh();
    const reference = opened.index.publish('ada', activity());
    expect(opened.index.verify(reference)).toEqual({ kind: 'consistent' });
    opened.close();

    const raw = createNodeSqlite().openSqlite(opened.path);
    raw.prepare(`UPDATE candidate_nodes SET scalar = ? WHERE result_key = 'ada' AND scalar = ?`).run('MDV1|["s","Mallory"]', 'MDV1|["s","Ada"]');
    raw.close();

    const reopened = createNodeSqlite().openSqlite(opened.path);
    const candidate = openCandidateNodeIndex({ connection: reopened, sha256: host, logicalStore: 'store:in-process' });
    expect(candidate.verify(reference)).toMatchObject({ kind: 'inconsistent', detail: expect.stringMatching(/nodes/u) as unknown });
    expect(() => candidate.reader.readSubtree(reference, [property('profile')])).toThrow(/snapshot fingerprint/u);
    reopened.close();
  });

  test('missing, wrong-scope, unknown-version and incompatible-content references fail rather than miss', () => {
    const opened = openFresh();
    const reference = opened.index.publish('ada', activity());
    const locatorBody = reference.locator.slice('mdnx1|'.length);
    const failing: readonly (readonly [ICompletedResultReference, RegExp])[] = [
      [{ kind: 'completed-result', locator: `mdnx1|${JSON.stringify(['store:in-process', 'missing'])}` }, /Missing exact/u],
      [{ kind: 'completed-result', locator: `mdnx1|${JSON.stringify(['store:other', 'ada'])}` }, /different logical store/u],
      [{ kind: 'completed-result', locator: `mdnx9|${locatorBody}` }, /locator version/u],
    ];
    for (const [candidate, message] of failing) {
      expect(() => opened.index.reader.readNode(candidate, [])).toThrow(message);
      expect(() => opened.index.reader.resolveFingerprint(candidate, { kind: 'selected', operation: 'value', address: [property('contributor')], encoding: 'MDO1' })).toThrow(message);
    }
    expect(opened.index.reader.resolveFingerprint(reference, { kind: 'projection', descriptor: { address: [], operation: 'value', traversal: { kind: 'exhaustive', complete: true } }, encoding: 'MDP1' }))
      .toEqual({ kind: 'unavailable' });
    opened.close();

    const raw = createNodeSqlite().openSqlite(opened.path);
    raw.prepare(`UPDATE candidate_results SET encoding = 'MDS9' WHERE result_key = 'ada'`).run();
    raw.close();
    const reopened = createNodeSqlite().openSqlite(opened.path);
    const candidate = openCandidateNodeIndex({ connection: reopened, sha256: host, logicalStore: 'store:in-process' });
    expect(() => candidate.reader.readNode(reference, [])).toThrow(/Unsupported stored result encoding/u);
    reopened.close();
  });

  test('another logical store, another schema version or an incomplete schema is rejected at open', () => {
    const opened = openFresh();
    opened.close();
    const wrongStore = createNodeSqlite().openSqlite(opened.path);
    expect(() => openCandidateNodeIndex({ connection: wrongStore, sha256: host, logicalStore: 'store:other' })).toThrow(/different logical store/u);
    wrongStore.prepare('UPDATE candidate_identity SET schema_version = 2').run();
    expect(() => openCandidateNodeIndex({ connection: wrongStore, sha256: host, logicalStore: 'store:in-process' })).toThrow(/schema version/u);
    wrongStore.exec('DROP TABLE candidate_addresses');
    expect(() => openCandidateNodeIndex({ connection: wrongStore, sha256: host, logicalStore: 'store:in-process' })).toThrow(/Incomplete candidate schema/u);
    wrongStore.close();
  });

  test('publication is immutable and requires a navigable container root', () => {
    const opened = openFresh();
    const reference = opened.index.publish('ada', activity());
    expect(() => opened.index.publish('ada', activity({ name: 'Replacement' }))).toThrow();
    expect(opened.index.reader.readNode(reference, [property('profile'), property('name')])).toMatchObject({ selected: { fact: 'Ada' } });
    expect(() => opened.index.publish('scalar', 'not a container')).toThrow(/record or array root/u);
    expect(() => opened.index.reader.readNode({ kind: 'completed-result', locator: `mdnx1|${JSON.stringify(['store:in-process', 'scalar'])}` }, [])).toThrow(/Missing exact/u);
    opened.close();
  });
});
