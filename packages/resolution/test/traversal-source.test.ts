/**
 * Resolution's existing callable boundary must refuse an uncaptured traversal
 * collection before its author callback. This isolated owner fixture uses the
 * established in-memory History port; it supplies no native, provider or live
 * traversal qualification evidence.
 */
import { expect, test } from '@jest/globals';
import { declarations } from '@microdelta/definition';
import type { ICollectionResult } from '@microdelta/definition';

import { createResolution } from '../src/resolution.js';
import type { IResolutionFamily } from '../src/family.js';
import { ResolutionError } from '../src/errors.js';
import { readProvenance } from '../src/evidence.js';
import type { ITraversalRunAuthority } from '../src/root-acquisition.js';
import { childHistory, host } from './child-history.js';

/** Query meaning is fixed by the composed input rather than a caller argument. */
interface IQuery { readonly person: string; readonly query: string }
/** Every frontier carries its membership and advertised fixed revision. */
interface IFrontier extends ICollectionResult<{ readonly id: string }> { readonly revision: string }
/** An ordinary page source returns one immutable response, not a collection mode. */
interface IPage { readonly continuation: string | undefined; readonly revision: string; readonly members: readonly { readonly id: string }[] }
/** Callback entry is a separate oracle from an eventual missing-evidence throw. */
interface IHelpers { readonly collected: () => void; readonly acquired: () => void; readonly invalid: () => never }

/** The only varied observation is whether the bound collection callback entered. */
function fixture(authority?: ITraversalRunAuthority) {
  let collectionBodies = 0;
  let pageBodies = 0;
  const builders = declarations<IResolutionFamily<{ readonly query: IQuery }, IHelpers>>();
  const page = builders.sourceSlot<readonly [IQuery, string | undefined], IPage>({ slot: 'page' });
  const supplied = builders.suppliedSource<readonly [IQuery, string | undefined], IPage>({ run: context => {
    context.helpers.acquired();
    if (context.args[0].person !== 'fixture/person' || context.args[0].query !== 'fixed') { return context.helpers.invalid(); }
    const members = context.args[1] === undefined ? [{ id: 'fixture/repo#101' }] : [{ id: 'fixture/repo#101' }, { id: 'fixture/repo#102' }];
    return context.outcome.fresh<IPage>({ continuation: context.args[1] === undefined ? 'next' : undefined, revision: 'r1', members });
  } });
  const collection = builders.source<IFrontier>({ subject: 'frontier', collection: { identity: 'id' }, run: context => {
    context.helpers.collected();
    if (context.evidence === undefined) { return context.helpers.invalid(); }
    const members: { readonly id: string }[] = [];
    for (let position = 0; position < context.evidence.members.length; position += 1) {
      const member = context.evidence.members[position];
      if (member === undefined) { return context.helpers.invalid(); }
      members.push({ id: member.id });
    }
    return context.outcome.fresh<IFrontier>({ members, status: context.evidence.status, revision: context.evidence.revision });
  } });
  const template = builders.template({ slot: 'prs', collection, steps: member => ({ assess: member.memo({ subject: member.subject('assessment'), run: context => ({ id: context.member.id }) }) }) });
  const fold = builders.fold({ subject: 'summary', over: { template, step: 'assess' }, run: context => ({ count: context.members.length }) });
  const relationship = builders.traversal({ slot: 'person-prs', query: 'query', page, collection, template, fold });
  const composition = builders.compose({
    scope: 'test', inputs: [{ slot: 'query', value: { person: 'fixture/person', query: 'fixed' } }],
    helpers: [
      { slot: 'collected', helper: () => { collectionBodies += 1; } },
      { slot: 'acquired', helper: () => { pageBodies += 1; } },
      { slot: 'invalid', helper: () => { throw new Error('Invalid captured fixture'); } },
    ],
    supplied: [builders.supplySource({ slot: page, declaration: supplied, subject: ([query, cursor]) => {
      if (query === undefined) { throw new Error('Expected current query arguments'); }
      return `page:${query.person}:${cursor ?? 'root'}`;
    } })],
    steps: [{ slot: 'frontier', declaration: collection }, { slot: 'summary', declaration: fold }], templates: [template], traversals: [relationship],
  });
  const memory = childHistory();
  const resolution = createResolution({
    declarations: builders, composition, bindings: { inputs: composition.topology.inputs, helpers: composition.topology.helpers },
    environment: 'production', history: memory.history, tracking: memory.tracking, host,
    admission: { admit: async () => ({ kind: 'admitted' }) },
    ...(authority === undefined ? {} : { traversalAuthority: authority }),
  });
  return { resolution, memory, composition, witness: builders.rootAcquisition(composition, relationship), collectionBodies: () => collectionBodies, pageBodies: () => pageBodies };
}

test('absent captured evidence refuses before a traversal collection callback or member', async () => {
  const run = fixture();
  let failure: unknown;
  try {
    await run.resolution.resolveFold({
      step: { scope: 'test', role: 'step', slot: 'summary' }, requestKey: 'uncaptured',
      lease: { holder: 'fixture', fence: 1, expiresAt: 30_000 },
    });
  } catch (error: unknown) { failure = error; }
  expect({ code: failure instanceof ResolutionError ? failure.code : undefined, bodies: run.collectionBodies() })
    .toEqual({ code: 'invalid-request', bodies: 0 });
});

test('a genuine captured request follows ordinary source publication, keying and strict waiting', async () => {
  const owner = {};
  const run = fixture({ currentOwner: () => owner, assertRoot: () => undefined });
  const port = run.resolution.traversals;
  if (port === undefined) { throw new Error('Expected run-bound traversal Resolution port'); }
  const traversal = port.open(run.witness);
  const lease = { holder: 'fixture', fence: 1, expiresAt: 30_000 };
  const page = await traversal.acquire({ requestKey: 'page-one', lease });
  if (page.kind !== 'accepted') { throw new Error('Expected current page source'); }
  const offer = traversal.offer(page.page, { ...page.page.data, status: 'open' });
  const evidence = traversal.capture(offer, 'consumer');
  const outcome = await run.resolution.resolveFold({ step: traversal.binding.fold, requestKey: 'consumer', lease, sourceEvidence: evidence });
  expect(outcome.outcome.kind).toBe('waiting');
  expect(outcome.members).toHaveLength(1);
  expect(run.collectionBodies()).toBe(1);
  if (outcome.discovery.kind !== 'keyed') { throw new Error('Expected normal keyed collection'); }
  const provenance = readProvenance(run.memory.history.readEnvelope(outcome.discovery.reference));
  if (provenance.status !== 'supported') { throw new Error('Expected ordinary source provenance'); }
  expect(provenance.provenance.observations.some(item => item.binding.path[0] === 'source-evidence')).toBe(true);
  traversal.dispose();
});

test('an owned F1 request remains open after F2 arrives, while a new closed request gets the new population', async () => {
  const owner = {};
  const run = fixture({ currentOwner: () => owner, assertRoot: () => undefined });
  const port = run.resolution.traversals;
  if (port === undefined) { throw new Error('Expected traversal port'); }
  const traversal = port.open(run.witness);
  const lease = { holder: 'fixture', fence: 1, expiresAt: 30_000 };
  const first = await traversal.acquire({ requestKey: 'page-one', lease });
  if (first.kind !== 'accepted') { throw new Error('Expected first page'); }
  const f1 = traversal.offer(first.page, { ...first.page.data, status: 'open' });
  const capturedF1 = traversal.capture(f1, 'consumer-one');
  const next = traversal.continuation(first.page, ['continuation']);
  const second = await traversal.acquire({ requestKey: 'page-two', lease, continuation: next });
  if (second.kind !== 'accepted') { throw new Error('Expected second page'); }
  const f2 = traversal.offer(second.page, { ...second.page.data, status: 'complete' });
  traversal.complete();
  expect(() => traversal.capture(f1, 'superseded')).toThrow();
  const old = await run.resolution.resolveFold({ step: traversal.binding.fold, requestKey: 'consumer-one', lease, sourceEvidence: capturedF1 });
  expect(old.outcome.kind).toBe('waiting');
  expect(old.members.map(member => member.key)).toEqual(['fixture/repo#101']);
  const current = await run.resolution.resolveFold({ step: traversal.binding.fold, requestKey: 'consumer-two', lease, sourceEvidence: traversal.capture(f2, 'consumer-two') });
  expect(current.outcome.kind).toBe('published');
  expect(current.members.map(member => member.key)).toEqual(['fixture/repo#101', 'fixture/repo#102']);
  const before = old.members[0]?.outcome;
  const after = current.members[0]?.outcome;
  if (before?.kind !== 'published' || after?.kind !== 'reused') { throw new Error('Expected ordinary exact member reuse'); }
  expect(after.reference).toEqual(before.reference);
  expect(old.outcome.kind).toBe('waiting');
  traversal.dispose();
});

test('wrong composition/run/request/fold evidence refuses before a consumer callback', async () => {
  const owner = {};
  let current: object = owner;
  const authority = { currentOwner: () => current, assertRoot: () => undefined };
  const run = fixture(authority);
  const other = fixture(authority);
  const port = run.resolution.traversals;
  if (port === undefined) { throw new Error('Expected traversal port'); }
  expect(() => port.open({})).toThrow();
  expect(() => port.open(other.witness)).toThrow();
  const traversal = port.open(run.witness);
  expect(() => port.open(run.witness)).toThrow();
  const lease = { holder: 'fixture', fence: 1, expiresAt: 30_000 };
  const page = await traversal.acquire({ requestKey: 'page', lease });
  if (page.kind !== 'accepted') { throw new Error('Expected accepted page'); }
  const offer = traversal.offer(page.page, { ...page.page.data, status: 'open' });
  const evidence = traversal.capture(offer, 'consumer');
  await expect(run.resolution.resolveFold({ step: traversal.binding.fold, requestKey: 'another-request', lease, sourceEvidence: evidence })).rejects.toMatchObject({ code: 'invalid-request' });
  await expect(other.resolution.resolveFold({ step: traversal.binding.fold, requestKey: 'consumer', lease, sourceEvidence: evidence })).rejects.toMatchObject({ code: 'invalid-request' });
  await expect(run.resolution.resolveFold({ step: traversal.binding.collection, requestKey: 'consumer', lease, sourceEvidence: evidence })).rejects.toMatchObject({ code: 'invalid-request' });
  await expect(run.resolution.resolveOutcomeFold({ step: traversal.binding.fold, requestKey: 'consumer', lease, sourceEvidence: evidence })).rejects.toMatchObject({ code: 'invalid-request' });
  current = {};
  await expect(run.resolution.resolveFold({ step: traversal.binding.fold, requestKey: 'consumer', lease, sourceEvidence: evidence })).rejects.toMatchObject({ code: 'invalid-request' });
  expect(run.collectionBodies()).toBe(0);
  expect(other.collectionBodies()).toBe(0);
  expect(run.pageBodies()).toBe(1);
  traversal.dispose();
});
