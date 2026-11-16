/** Literal legacy/new histories preserve exact storage while current bindings and integrity retain authority. */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import type { ICompletedResultReference, IDurableHistory, IVersionedRecord } from '@microdelta/history';
import { createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import { createResolution, ResolutionError } from '@microdelta/resolution';
import { createTrackingObserver } from '@microdelta/tracking';
import { encodeSelectedFact, observe } from '@microdelta/value';
import { authoring, sourceOutcome } from 'microdelta';
import type { ISourceOutcome } from 'microdelta';
import { cleanup, freshLocation, openHistory } from '../durable-history/support.js';

/** Ordinary immutable inputs have a current identity independent of a prior result. */
interface IInputs { readonly data: { readonly name: string } }
/** Fixture adapters carry all external test counters through declared tracked helper bindings. */
interface IHelpers {
  readonly acquire: () => ISourceOutcome<{ readonly value: number }>;
  readonly accept: () => boolean;
  readonly summary: (name: string) => { readonly name: string };
  readonly parent: (value: number) => { readonly value: number };
}
/** Counters expose all work that must remain behind candidate integrity validation. */
const work = { source: 0, finality: 0, memo: 0, admission: 0, allocation: 0 };
beforeEach(() => { Object.assign(work, { source: 0, finality: 0, memo: 0, admission: 0, allocation: 0 }); });
afterEach(cleanup);
/** The author source consumes no current data, making its exact legacy evidence independently enumerable. */
function sourceBody({ helpers }: { readonly helpers: IHelpers }): ISourceOutcome<{ readonly value: number }> { return helpers.acquire(); }
/** External acquisition is a declared adapter, not an undeclared author capture. */
function acquire(): ISourceOutcome<{ readonly value: number }> { work.source++; return sourceOutcome.fresh({ value: 7 }); }
/** A policy is current work, never authority to bypass malformed evidence. */
function sourceFinality({ helpers }: { readonly helpers: IHelpers }): boolean { return helpers.accept(); }
/** Current policy work is visible through the declared adapter. */
function accept(): boolean { work.finality++; return true; }
/** Rebinding must preserve an equal selected name and invalidate a changed name. */
function memoBody({ inputs, helpers }: { readonly inputs: IInputs; readonly helpers: IHelpers }): { readonly name: string } { return helpers.summary(inputs.data.name); }
/** The fixture formatter counts work without leaking its counter into author input. */
function summary(name: string): { readonly name: string } { work.memo++; return { name }; }
/** A distinct current source implementation deliberately acquires equal data. */
function changedSourceBody({ helpers }: { readonly helpers: IHelpers }): ISourceOutcome<{ readonly value: number }> {
  const result = helpers.acquire();
  return result;
}
/** Parent's consumed child value is its only data dependency; child implementation belongs to the child. */
async function parentBody({ calls, helpers }: { readonly calls: { readonly source: () => Promise<{ readonly data: { readonly value: number } }> }; readonly helpers: IHelpers }): Promise<{ readonly value: number }> {
  const child = await calls.source();
  return helpers.parent(child.data.value);
}
/** Declared parent formatting exposes parent work independently from current child acquisition. */
function parent(value: number): { readonly value: number } { work.memo++; return { value }; }
const host = createNodeMachine();
const scope = 'wire-upgrade';
let request = 0;

/** Fresh declarations, Tracking and a reopened History connection model another session in the same OS process. */
function open(location: string, name = 'Ada', sourceVariant: 'original' | 'changed' = 'original') {
  const builders = authoring<IInputs, IHelpers>();
  const source = sourceVariant === 'original'
    ? builders.source({ subject: 'source', run: sourceBody, finality: sourceFinality })
    : builders.source({ subject: 'source', run: changedSourceBody, finality: sourceFinality });
  const parentStep = builders.memo({ subject: 'parent', children: { source }, run: parentBody });
  const memo = builders.memo({ subject: 'memo', run: memoBody });
  const composition = builders.compose({ scope, inputs: [{ slot: 'data', value: { name } }], helpers: [{ slot: 'acquire', helper: acquire }, { slot: 'accept', helper: accept }, { slot: 'summary', helper: summary }, { slot: 'parent', helper: parent }], steps: [{ slot: 'source', declaration: source }, { slot: 'memo', declaration: memo }, { slot: 'parent', declaration: parentStep }] });
  const history = openHistory({ location });
  const acquired = history.acquireWriter({ holder: 'wire-upgrade-proof', leaseMilliseconds: 60_000 });
  if (acquired.kind !== 'acquired') { throw new Error('Expected writer lease'); }
  const authority: IDurableHistory = { ...history, allocateAttempt(lease, options) { work.allocation++; return history.allocateAttempt(lease, options); } };
  const resolution = createResolution({ declarations: builders, composition, bindings: { inputs: ['data'], helpers: ['acquire', 'accept', 'summary', 'parent'] }, environment: 'test', history: authority, host, tracking: createTrackingObserver(host), admission: { admit() { work.admission++; return { kind: 'admitted' }; } } });
  return {
    history, location,
    async resolve(slot: 'source' | 'memo' | 'parent') { request++; return resolution.resolve({ step: { scope, role: 'step', slot }, requestKey: `resolve-${String(request)}`, lease: acquired.lease }); },
    seed(slot: 'source' | 'memo' | 'parent', provenance: IVersionedRecord, dependencies: readonly ICompletedResultReference[] = []): ICompletedResultReference {
      request++;
      const attempt = history.allocateAttempt(acquired.lease, { analysis: scope, environment: 'test', subject: slot, version: 1, attemptKey: `seed-${String(request)}`, intentDigest: `literal-${String(request)}` });
      history.stageAttempt(acquired.lease, { attemptId: attempt.attemptId, payload: slot === 'memo' ? { name } : { value: 7 }, provenance, dependencies });
      return history.publishAttempt(acquired.lease, attempt.attemptId);
    },
    close(): void { history.releaseWriter(acquired.lease); history.close(); },
  };
}

/** Tracking's implementation scalar is parameterized from controlled source text, never a provenance writer. */
function implementation(body: object, path: readonly string[] = ['self']) {
  const encoded = `MDF1|${host.sha256(JSON.stringify(Function.prototype.toString.call(body)))}`;
  return { binding: { path: path.map(segment => segment) }, address: [], selection: { kind: 'implementation', address: [], encodingVersion: 'MDF1' }, kind: 'implementation', operation: 'implementation', encodingVersion: 'MDF1', encoded, fingerprint: host.sha256(encoded) };
}
/** Complete literal wire1 shape; only public Value current facts parameterize input digests. */
function legacy(slot: 'source' | 'memo', name = 'Ada'): IVersionedRecord {
  const inputs = { data: { name } };
  const observations = [implementation(slot === 'source' ? sourceBody : memoBody), ...(slot === 'source' ? [] : [
    { operation: 'container-kind', address: [{ kind: 'property', key: 'data' }] },
    { operation: 'value', address: [{ kind: 'property', key: 'data' }, { kind: 'property', key: 'name' }] },
  ].map(({ operation, address }) => {
    if (operation !== 'container-kind' && operation !== 'value') { throw new Error('Expected literal selected operation'); }
    const selectedAddress = address.map(segment => ({ kind: 'property' as const, key: segment.key }));
    const encoded = encodeSelectedFact(observe(inputs, selectedAddress, operation));
    return { binding: { path: ['inputs'] }, address: selectedAddress, selection: { kind: 'selected', operation, address: selectedAddress.map(segment => ({ ...segment })), encodingVersion: 'MDO1' }, kind: 'fact', operation, encodingVersion: 'MDO1', encoded, fingerprint: host.sha256(encoded) };
  })), implementation(slot === 'source' ? acquire : summary, ['callable', slot === 'source' ? 'acquire' : 'summary'])];
  return { format: 'microdelta.resolution.provenance', formatVersion: 1, content: { trackingSemantics: 2, kind: slot, step: { scope, role: 'step', slot }, observations, children: [] } };
}
/** Complete literal wire5 source, independently spelling the tuple and semantic axis. */
function currentSource(): IVersionedRecord {
  const own = implementation(sourceBody);
  const adapter = implementation(acquire, ['callable', 'acquire']);
  return { format: 'microdelta.resolution.provenance', formatVersion: 5, content: { trackingSemantics: 2, semanticVersion: 1, kind: 'source', step: { scope, role: 'step', slot: 'source' }, observations: [[['self'], [], [1, []], 1, 'implementation', 'MDF1', [own.encoded], own.fingerprint], [['callable', 'acquire'], [], [1, []], 1, 'implementation', 'MDF1', [adapter.encoded], adapter.fingerprint]], children: [] } };
}
/** Storage identity includes the exact owner content and dependency references, not mutable acceptance rows. */
function stored(session: ReturnType<typeof open>, reference: ICompletedResultReference): string {
  const envelope = session.history.readEnvelope(reference);
  const sqlite = createNodeSqlite().openSqlite(session.location);
  try {
    const wire = sqlite.prepare('SELECT provenance_format, provenance_version, provenance FROM history_results WHERE analysis = ? AND environment = ? AND subject = ? AND publication = ?').get(envelope.analysis, envelope.environment, envelope.subject, envelope.publication);
    if (wire === undefined) { throw new Error('Expected exact provenance storage row'); }
    return JSON.stringify({ wire, dependencies: envelope.dependencies, reference: envelope.reference });
  } finally { sqlite.close(); }
}
/** Schema objects are compared across legitimate acceptance/publication work, without hashing the mutable database. */
function schema(location: string): unknown {
  const sqlite = createNodeSqlite().openSqlite(location);
  try { return sqlite.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all(); } finally { sqlite.close(); }
}

test('literal legacy memo survives restart/equal rebinding, then mixed history publishes wire5 for changed consumed name without rewriting legacy', async () => {
  const location = freshLocation();
  const first = open(location);
  const reference = first.seed('memo', legacy('memo'));
  const exact = stored(first, reference);
  first.close();
  const originalSchema = schema(location);
  const same = open(location, 'Ada');
  try {
    const result = await same.resolve('memo');
    expect(result).toMatchObject({ kind: 'reused', reference });
    expect(work).toEqual({ source: 0, finality: 0, memo: 0, admission: 0, allocation: 0 });
    expect(stored(same, reference)).toBe(exact);
  } finally { same.close(); }
  const changed = open(location, 'Ada L.');
  let published: ICompletedResultReference;
  try {
    const result = await changed.resolve('memo');
    expect(result.kind).toBe('published');
    if (result.kind !== 'published') { throw new Error('Expected changed-name publication'); }
    published = result.reference;
    expect(published).not.toEqual(reference);
    expect(changed.history.reader.readSubtree(published, [])).toEqual({ name: 'Ada L.' });
    expect(changed.history.readEnvelope(published).provenance).toMatchObject({ formatVersion: 5, content: { semanticVersion: 1, trackingSemantics: 2, kind: 'memo' } });
    expect(stored(changed, reference)).toBe(exact);
  } finally { changed.close(); }
  const warm = open(location, 'Ada L.');
  try {
    expect(await warm.resolve('memo')).toMatchObject({ kind: 'reused', reference: published });
    expect(stored(warm, reference)).toBe(exact);
    expect(work.memo).toBe(1);
    expect(warm.history.findCandidates({ analysis: scope, environment: 'test', subject: 'memo', version: 1 }).map(candidate => candidate.reference)).toEqual([published, reference]);
  } finally { warm.close(); }
  expect(schema(location)).toEqual(originalSchema);
});

test.each(['legacy', 'current'] as const)('future semantic newest misses and exact %s candidate remains reusable after restart', async kind => {
  const location = freshLocation();
  const initial = open(location);
  const reference = initial.seed('source', kind === 'legacy' ? legacy('source') : currentSource());
  const exact = stored(initial, reference);
  const future = initial.seed('source', { format: 'microdelta.resolution.provenance', formatVersion: 5, content: { trackingSemantics: 2, semanticVersion: 5, observations: 'future uninterpretable body' } });
  initial.close();
  const restarted = open(location);
  try {
    const result = await restarted.resolve('source');
    expect(result).toMatchObject({ kind: 'reused', reference });
    expect(result.misses.map(miss => [miss.candidate, miss.reason])).toEqual([[future, 'unsupported-evidence']]);
    expect(stored(restarted, reference)).toBe(exact);
    expect(work).toEqual({ source: 0, finality: 1, memo: 0, admission: 0, allocation: 0 });
  } finally { restarted.close(); }
});

test('literal legacy parent retains its exact child dependency while current wire5 child rebinds and publishes equal output', async () => {
  const location = freshLocation();
  const initial = open(location);
  const childReference = initial.seed('source', currentSource());
  const address = [{ kind: 'property' as const, key: 'value' }];
  const encoded = encodeSelectedFact(observe({ value: 7 }, address, 'value'));
  const parentReference = initial.seed('parent', {
    format: 'microdelta.resolution.provenance', formatVersion: 1,
    content: { trackingSemantics: 2, kind: 'memo', step: { scope, role: 'step', slot: 'parent' },
      observations: [implementation(parentBody), {
        binding: { path: ['child', 'source'] }, address,
        selection: { kind: 'selected', operation: 'value', address: address.map(segment => ({ ...segment })), encodingVersion: 'MDO1' },
        kind: 'fact', operation: 'value', encodingVersion: 'MDO1', encoded, fingerprint: host.sha256(encoded),
      }, implementation(parent, ['callable', 'parent'])],
      children: [{ slot: 'source', witness: { version: 1, parent: { scope, role: 'step', slot: 'parent' }, child: { scope, role: 'step', slot: 'source' }, arguments: { form: 'empty' } }, reference: childReference, binding: { path: ['child', 'source'] } }],
    },
  }, [childReference]);
  const originalParent = stored(initial, parentReference);
  const originalChild = stored(initial, childReference);
  initial.close();
  const rebound = open(location, 'Ada', 'changed');
  let currentChild: ICompletedResultReference;
  try {
    const result = await rebound.resolve('parent');
    expect(result).toMatchObject({ kind: 'reused', reference: parentReference });
    const selected = rebound.history.readCurrent({ analysis: scope, environment: 'test', subject: 'source' });
    if (selected === undefined) { throw new Error('Expected current child publication'); }
    currentChild = selected;
    expect(currentChild).not.toEqual(childReference);
    expect(rebound.history.readEnvelope(currentChild).provenance).toMatchObject({ formatVersion: 5, content: { semanticVersion: 1, kind: 'source' } });
    expect(rebound.history.reader.readSubtree(currentChild, [])).toEqual({ value: 7 });
    expect(rebound.history.readEnvelope(parentReference).dependencies).toEqual([childReference]);
    expect(stored(rebound, parentReference)).toBe(originalParent);
    expect(stored(rebound, childReference)).toBe(originalChild);
    expect(work).toEqual({ source: 1, finality: 0, memo: 0, admission: 1, allocation: 1 });
  } finally { rebound.close(); }
  const again = open(location, 'Ada', 'changed');
  try {
    expect(await again.resolve('parent')).toMatchObject({ kind: 'reused', reference: parentReference });
    expect(again.history.readCurrent({ analysis: scope, environment: 'test', subject: 'source' })).toEqual(currentChild);
    expect(again.history.readEnvelope(parentReference).dependencies).toEqual([childReference]);
    expect(stored(again, parentReference)).toBe(originalParent);
    expect(stored(again, childReference)).toBe(originalChild);
    expect(work).toEqual({ source: 1, finality: 1, memo: 0, admission: 1, allocation: 1 });
  } finally { again.close(); }
});

test.each(['legacy', 'current'] as const)('ordinary ordering reuses the newest valid %s spelling over the other spelling', async newest => {
  const location = freshLocation();
  const initial = open(location);
  const older = initial.seed('source', newest === 'legacy' ? currentSource() : legacy('source'));
  const exactOlder = stored(initial, older);
  const reference = initial.seed('source', newest === 'legacy' ? legacy('source') : currentSource());
  const exactLatest = stored(initial, reference);
  initial.close();
  const reopened = open(location);
  try {
    const result = await reopened.resolve('source');
    expect(result).toMatchObject({ kind: 'reused', reference, misses: [] });
    expect(stored(reopened, older)).toBe(exactOlder);
    expect(stored(reopened, reference)).toBe(exactLatest);
    expect(work).toEqual({ source: 0, finality: 1, memo: 0, admission: 0, allocation: 0 });
  } finally { reopened.close(); }
});

describe('known current-generation corruption precedes all current source work and does not fall back', () => {
  test.each([
    { label: 'missing semantic', content: { trackingSemantics: 2 } },
    { label: 'text semantic', content: { trackingSemantics: 2, semanticVersion: '1' } },
    { label: 'fraction semantic', content: { trackingSemantics: 2, semanticVersion: 1.5 } },
    { label: 'nonpositive semantic', content: { trackingSemantics: 2, semanticVersion: 0 } },
    { label: 'unsafe semantic', content: { trackingSemantics: 2, semanticVersion: Number.MAX_SAFE_INTEGER + 1 } },
    { label: 'malformed tuple', content: { trackingSemantics: 2, semanticVersion: 1, kind: 'source', step: { scope, role: 'step', slot: 'source' }, observations: [[]], children: [] } },
    { label: 'no own implementation', content: { trackingSemantics: 2, semanticVersion: 1, kind: 'source', step: { scope, role: 'step', slot: 'source' }, observations: [], children: [] } },
  ])('$label cannot reach policy/finality/admission/body/allocation', async ({ content }) => {
    const location = freshLocation();
    const session = open(location);
    try {
      const older = session.seed('source', legacy('source'));
      const exact = stored(session, older);
      session.seed('source', { format: 'microdelta.resolution.provenance', formatVersion: 5, content });
      let failure: unknown;
      try { await session.resolve('source'); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(ResolutionError);
      if (!(failure instanceof ResolutionError)) { throw new Error('Expected current-generation integrity failure'); }
      expect(failure.code).toBe('integrity');
      expect(work).toEqual({ source: 0, finality: 0, memo: 0, admission: 0, allocation: 0 });
      expect(stored(session, older)).toBe(exact);
    } finally { session.close(); }
  });
  test.each([undefined, 1, 3, '2'])('unsupported Tracking %s ignores malformed tag/body and reuses legacy without allocation', async trackingSemantics => {
    const location = freshLocation();
    const session = open(location);
    try {
      const older = session.seed('source', legacy('source'));
      session.seed('source', { format: 'microdelta.resolution.provenance', formatVersion: 5, content: { trackingSemantics, semanticVersion: '1', observations: [[]] } });
      expect(await session.resolve('source')).toMatchObject({ kind: 'reused', reference: older });
      expect(work).toEqual({ source: 0, finality: 1, memo: 0, admission: 0, allocation: 0 });
    } finally { session.close(); }
  });
});
