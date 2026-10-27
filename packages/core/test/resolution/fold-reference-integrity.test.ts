/**
 * Fold integrity keeps immutable historical obligations separate from current
 * acceptance. Tests inject narrowly selected contractual History-port faults
 * around genuine stored envelopes; ordinary calls still reach durable History.
 */
import { inspectProvenanceObservations } from '../provenance-wire-inspection.js';
import { afterEach, expect, test } from '@jest/globals';
import { HistoryIntegrityError } from '@microdelta/history';
import type { IAcceptanceRequest, ICompletedEnvelope, ICompletedResultReference, IDurableHistory, IStageRequest } from '@microdelta/history';
import { createNodeMachine } from '@microdelta/machine-node';
import { createResolution } from '@microdelta/resolution';
import { createTrackingObserver } from '@microdelta/tracking';
import { authoring, sourceOutcome } from 'microdelta';
import type { ISourceOutcome } from 'microdelta';

import { cleanup, freshLocation, openHistory } from '../durable-history/support.js';
import { analysis, composeFold, createWorld, reportSubject, resetWorld, world } from '../fold/fixture.js';

afterEach(cleanup);

/** Narrow stored record data without treating opaque provenance as trusted types. */
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) { throw new Error('Expected provenance record'); }
  return Object.fromEntries(Object.entries(value));
}

/** Edit only owner-defined provenance while retaining a genuine stored envelope. */
function content(candidate: ICompletedEnvelope, edit: (value: Record<string, unknown>) => Record<string, unknown>): ICompletedEnvelope {
  return { ...candidate, provenance: { ...candidate.provenance, content: edit(record(candidate.provenance.content)) } };
}

/** A sparse consumer over three included members, with transparent port traffic. */
function openProof(sparse = true) {
  resetWorld(createWorld());
  const fixture = composeFold(sparse ? { report: 'first-only' } : {});
  const history = openHistory({ location: freshLocation() });
  const acquired = history.acquireWriter({ holder: 'fold-integrity-proof', leaseMilliseconds: 60_000 });
  if (acquired.kind !== 'acquired') { throw new Error('Expected writer lease'); }
  const reads: string[] = [];
  const acceptances: IAcceptanceRequest[] = [];
  let candidates: (values: readonly ICompletedEnvelope[]) => readonly ICompletedEnvelope[] = (values) => values;
  let envelope: (value: ICompletedEnvelope) => ICompletedEnvelope = (value) => value;
  const authority: IDurableHistory = {
    ...history,
    findCandidates(subject) {
      const stored = history.findCandidates(subject);
      return subject.subject === reportSubject ? candidates(stored) : stored;
    },
    readEnvelope(reference) {
      reads.push(reference.locator);
      return envelope(history.readEnvelope(reference));
    },
    recordAcceptance(lease, request) { acceptances.push(request); return history.recordAcceptance(lease, request); },
  };
  const host = createNodeMachine();
  /** Fresh current declarations can change own facts without changing stored history. */
  function resolver(selected: typeof fixture) { return createResolution({ declarations: selected.builders, composition: selected.composition,
    bindings: { inputs: ['config'], helpers: ['discover', 'discoveryFinal', 'meets', 'summarize', 'render', 'renderIncluded', 'renderFirst', 'renderReadingSkipped', 'renderThrowing'] },
    environment: 'fold-integrity-proof', history: authority, host, tracking: createTrackingObserver(host),
    admission: { admit: () => ({ kind: 'admitted' }) },
  }); }
  let resolution = resolver(fixture);
  return {
    history, reads, acceptances,
    differentBody(): void { resolution = resolver(composeFold()); },
    candidates(edit: typeof candidates): void { candidates = edit; },
    envelope(edit: typeof envelope): void { envelope = edit; },
    async run(key: string) { reads.length = 0; return resolution.resolveFold({ step: fixture.report, requestKey: key, lease: acquired.lease }); },
    candidate(): ICompletedEnvelope {
      const candidate = history.findCandidates({ analysis, environment: 'fold-integrity-proof', subject: reportSubject, version: 1 })[0];
      if (candidate === undefined) { throw new Error('Expected retained fold candidate'); }
      return candidate;
    },
    close(): void { history.releaseWriter(acquired.lease); history.close(); },
  };
}

/** Return the exact reference only after proving real publication or reuse. */
function success(report: Awaited<ReturnType<ReturnType<typeof openProof>['run']>>, kind: 'published' | 'reused'): ICompletedResultReference {
  expect(report.outcome.kind).toBe(kind);
  if (report.outcome.kind !== 'published' && report.outcome.kind !== 'reused') { throw new Error('Expected successful fold'); }
  return report.outcome.reference;
}

/** Exact canonical dependency vector; the sparse body consumes only Ada. */
function dependencies(proof: ReturnType<typeof openProof>): readonly ICompletedResultReference[] { return proof.candidate().dependencies; }

/** Narrow indexed test evidence, keeping out-of-range fixtures explicit. */
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) { throw new Error(`Missing fixture entry ${String(index)}`); }
  return value;
}

test('a sparse fold checks every included historical envelope although only the first member was consumed', async () => {
  const proof = openProof();
  try {
    const reference = success(await proof.run('cold'), 'published');
    const refs = dependencies(proof);
    const candidate = proof.candidate();
    const bindings = inspectProvenanceObservations(candidate.provenance.content).map((value) => value.binding.path);
    expect(bindings.filter((path) => Array.isArray(path) && path[0] === 'entry')).toEqual([['entry', 'person:ada']]);
    expect(success(await proof.run('warm'), 'reused')).toEqual(reference);
    expect(proof.reads).toEqual(refs.map((entry) => entry.locator));
  } finally { proof.close(); }
});

test.each(['missing-envelope', 'scope'] as const)('an unconsumed included member retains its %s integrity obligation', async (fault) => {
  const proof = openProof();
  try {
    success(await proof.run('cold'), 'published');
    const refs = dependencies(proof);
    const last = at(refs, 2);
    proof.envelope((candidate) => {
      if (candidate.reference.locator !== last.locator) { return candidate; }
      if (fault === 'missing-envelope') { throw new HistoryIntegrityError('exact historical envelope unavailable'); }
      return { ...candidate, analysis: 'another-analysis' };
    });
    await expect(proof.run('fault')).rejects.toMatchObject({ code: 'integrity', message: fault === 'scope'
      ? `Recorded member person:cy of ${proof.candidate().reference.locator} is outside this History scope`
      : 'Historical evidence failed integrity: exact historical envelope unavailable' });
    expect(proof.reads).toEqual(refs.map((entry) => entry.locator));
  } finally { proof.close(); }
});

test('a missing unconsumed dependency fails before its read and every later read, preserving the exact message', async () => {
  const proof = openProof();
  try {
    success(await proof.run('cold'), 'published');
    const candidate = proof.candidate();
    const refs = candidate.dependencies;
    proof.candidates((values) => values.map((value) => ({ ...value, dependencies: [at(refs, 0), at(refs, 2)] })));
    proof.envelope((value) => {
      if (value.reference.locator !== at(refs, 0).locator) { throw new HistoryIntegrityError('later read must not win'); }
      return value;
    });
    await expect(proof.run('missing')).rejects.toMatchObject({ code: 'integrity', message: `Recorded member person:ben of ${candidate.reference.locator} is not among its exact dependencies` });
    expect(proof.reads).toEqual([at(refs, 0).locator]);
  } finally { proof.close(); }
});

test('an earlier historical fault wins over a later missing dependency', async () => {
  const proof = openProof();
  try {
    success(await proof.run('cold'), 'published');
    const refs = dependencies(proof);
    proof.candidates((values) => values.map((value) => ({ ...value, dependencies: [at(refs, 0)] })));
    proof.envelope(() => { throw new HistoryIntegrityError('earlier exact read failed'); });
    await expect(proof.run('earlier')).rejects.toMatchObject({ code: 'integrity', message: 'Historical evidence failed integrity: earlier exact read failed' });
    expect(proof.reads).toEqual([at(refs, 0).locator]);
  } finally { proof.close(); }
});

// Each miss guard precedes dependency integrity. A zero-length dependency list
// would otherwise produce an integrity error on the first included member.
test.each(['unsupported', 'kind', 'over', 'own-fact', 'membership'] as const)('%s miss precedes dependency traversal', async (guard) => {
  const proof = openProof();
  try {
    success(await proof.run('cold'), 'published');
    const candidate = proof.candidate();
    let changed = candidate;
    if (guard === 'unsupported') { changed = { ...candidate, provenance: { ...candidate.provenance, formatVersion: 9 } }; }
    if (guard === 'kind') { changed = content(candidate, (value) => ({ trackingSemantics: value.trackingSemantics, semanticVersion: 1, kind: 'source', step: value.step, observations: value.observations, children: [] })); }
    if (guard === 'over') { changed = content(candidate, (value) => ({ ...value, over: { ...record(value.over), slot: 'other' } })); }
    if (guard === 'own-fact') { proof.differentBody(); }
    if (guard === 'membership') { changed = content(candidate, (value) => {
      const members: unknown = value.membership;
      if (!Array.isArray(members)) { throw new Error('Expected membership'); }
      return { ...value, membership: members.slice(0, 2) };
    }); }
    proof.candidates(() => [{ ...changed, dependencies: [] }]);
    const outcome = await proof.run(`guard-${guard}`);
    expect(outcome.outcome.kind).toBe('published');
    expect(proof.reads).toEqual([]);
  } finally { proof.close(); }
});

test('an unread member change keeps historical references while current acceptance follows the new member', async () => {
  const proof = openProof(false);
  try {
    const reference = success(await proof.run('cold'), 'published');
    const original = proof.candidate();
    world.discoveryFinal = false;
    world.roster = { ...world.roster, members: world.roster.members.map((member) => member.key === 'person:ben' ? { ...member, login: 'benjamin' } : member) };
    const report = await proof.run('unread-change');
    expect(success(report, 'reused')).toEqual(reference);
    expect(proof.reads).toEqual(original.dependencies.map((entry) => entry.locator));
    expect(proof.candidate()).toEqual(original);
    const acceptance = [...proof.acceptances].reverse().find((value) => value.reference.locator === reference.locator);
    expect(acceptance?.dependencies).toHaveLength(3);
    expect(acceptance?.dependencies[0]).toEqual(original.dependencies[0]);
    expect(acceptance?.dependencies[1]).not.toEqual(original.dependencies[1]);
    expect(acceptance?.dependencies[2]).toEqual(original.dependencies[2]);
  } finally { proof.close(); }
});

test('an earlier candidate index cannot authorize a later candidate or a later request', async () => {
  const proof = openProof(false);
  try {
    success(await proof.run('cold'), 'published');
    const original = proof.candidate();
    world.discoveryFinal = false;
    world.roster = { ...world.roster, members: world.roster.members.map((member) => member.key === 'person:ada' ? { ...member, score: 9 } : member) };
    proof.candidates(() => [original, { ...original, dependencies: [] }]);
    const message = `Recorded member person:ada of ${original.reference.locator} is not among its exact dependencies`;
    await expect(proof.run('two-candidates')).rejects.toMatchObject({ code: 'integrity', message });
    expect(proof.reads).toEqual(original.dependencies.map((entry) => entry.locator));
    proof.candidates(() => [{ ...original, dependencies: [] }]);
    await expect(proof.run('later-request')).rejects.toMatchObject({ code: 'integrity', message });
    expect(proof.reads).toEqual([]);
  } finally { proof.close(); }
});

/** No ambient inputs or helpers participate in this aliasing witness. */
type IEmpty = Record<never, never>;

 /** Equal content remains distinct from completed-result identity. */
interface IAliasPayload { readonly value: number }

/** A declared source adapter keeps fresh acquisition within tracked author bindings. */
interface IAliasHelpers { readonly fresh: () => ISourceOutcome<IAliasPayload> }

/** Two independent sources deliberately acquire equal content. */
function equalSource(): ISourceOutcome<IAliasPayload> { return sourceOutcome.fresh({ value: 7 }); }

test('ordinary publication keeps the first equal-locator object in canonical child order and preserves distinct equal payloads', async () => {
  const builders = authoring<IEmpty, IAliasHelpers>();
  const shared = builders.source<IAliasPayload>({ subject: 'shared-source', finality: () => true, run: ({ helpers }) => helpers.fresh() });
  const other = builders.source<IAliasPayload>({ subject: 'other-source', finality: () => true, run: ({ helpers }) => helpers.fresh() });
  const parent = builders.memo({ subject: 'parent', children: { a: shared, b: shared, c: other }, run: async ({ calls }) => {
    const c = await calls.c();
    const b = await calls.b();
    const a = await calls.a();
    return { sum: c.data.value + b.data.value + a.data.value };
  } });
  const composition = builders.compose({ scope: 'reference-alias', inputs: [], helpers: [{ slot: 'fresh', helper: equalSource }], steps: [
    { slot: 'parent', declaration: parent }, { slot: 'c', declaration: other }, { slot: 'b', declaration: shared }, { slot: 'a', declaration: shared },
  ] });
  const history = openHistory({ location: freshLocation() });
  const acquired = history.acquireWriter({ holder: 'alias-proof', leaseMilliseconds: 60_000 });
  if (acquired.kind !== 'acquired') { throw new Error('Expected writer lease'); }
  const published: ICompletedResultReference[] = [];
  const accepted: ICompletedResultReference[] = [];
  const stages: IStageRequest[] = [];
  const authority: IDurableHistory = {
    ...history,
    findCandidates(subject) {
      // Fresh ordinary reference objects retain all real envelope values. This
      // proves duplicate equality independently of request object sharing.
      return history.findCandidates(subject).map((candidate) => ({ ...candidate, reference: { ...candidate.reference } }));
    },
    publishAttempt(lease, attemptId) { const reference = history.publishAttempt(lease, attemptId); published.push(reference); return reference; },
    recordAcceptance(lease, request) { accepted.push(request.reference); return history.recordAcceptance(lease, request); },
    stageAttempt(lease, request) { stages.push(request); return history.stageAttempt(lease, request); },
  };
  const host = createNodeMachine();
  const resolution = createResolution({ declarations: builders, composition, bindings: { inputs: [], helpers: ['fresh'] },
    environment: 'alias-proof', history: authority, host, tracking: createTrackingObserver(host), admission: { admit: () => ({ kind: 'admitted' }) },
  });
  try {
    const outcome = await resolution.resolve({ step: { scope: 'reference-alias', role: 'step', slot: 'parent' }, requestKey: 'alias', lease: acquired.lease });
    expect(outcome.kind).toBe('published');
    expect(published).toHaveLength(3);
    expect(accepted).toHaveLength(1);
    const first = at(accepted, 0);
    expect(first).toEqual(at(published, 1));
    expect(first).not.toBe(at(published, 1));
    const stage = at(stages, 2);
    expect(stage.provenance.formatVersion).toBe(5);
    expect(stage.dependencies.map((reference) => reference.locator)).toEqual([first.locator, at(published, 0).locator]);
    expect(stage.dependencies[0]).toBe(first);
    expect(stage.dependencies[1]).toBe(published[0]);
    expect(first.locator).not.toBe(at(published, 0).locator);
    for (const reference of stage.dependencies) { expect(history.reader.readSubtree(reference, [])).toEqual({ value: 7 }); }
  } finally { history.releaseWriter(acquired.lease); history.close(); }
});
