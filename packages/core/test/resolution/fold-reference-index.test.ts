/**
 * Exact-reference bookkeeping through real Resolution, Tracking and durable
 * History. Boundary probes preserve ordinary locator values and delegated
 * searches; they measure visits, not Set internals or elapsed time.
 */
import { afterEach, expect, test } from '@jest/globals';
import type { ICompletedEnvelope, ICompletedResultReference, IDurableHistory, IStageRequest } from '@microdelta/history';
import { createNodeMachine } from '@microdelta/machine-node';
import { createResolution } from '@microdelta/resolution';
import { createTrackingObserver } from '@microdelta/tracking';

import { cleanup, freshLocation, openHistory } from '../durable-history/support.js';
import { analysis, composeFold, createWorld, reportSubject, resetWorld } from '../fold/fixture.js';

afterEach(cleanup);

/** The two independently bounded Resolution responsibilities. */
type IRoute = 'uniqueReferences' | 'evaluateFoldCandidate';
/** Actual observable work, reset between publication and retained validation. */
interface IWork { locators: number; comparisons: number; active: boolean; readonly operands: Set<string>; readonly references: WeakMap<object, string> }

/**
 * Count visits to actual boundary reference operands and copied locator strings.
 * Scoped activation excludes fixture assertions; real predicates remain intact.
 */
async function observeSearch<T>(_route: IRoute, work: IWork, body: () => Promise<T>): Promise<T> {
  const original = Array.prototype.some;
  const observedSome = function <TValue>(
    this: TValue[], predicate: (value: TValue, index: number, array: TValue[]) => unknown, receiver?: unknown,
  ): boolean {
    return Boolean(Reflect.apply(original, this, [(value: TValue, index: number, array: TValue[]): unknown => {
      const operand: unknown = value;
      const locator: unknown = typeof operand === 'string' ? operand
        : typeof operand === 'object' && operand !== null ? work.references.get(operand) : undefined;
      if (typeof locator === 'string' && work.operands.has(locator)) { work.comparisons += 1; }
      return predicate.call(receiver, value, index, array);
    }]));
  };
  Array.prototype.some = observedSome;
  work.active = true;
  try { return await body(); } finally { work.active = false; Array.prototype.some = original; }
}

/** An ordinary reference with a value-preserving read probe; no locator parsing. */
function observedReference(reference: ICompletedResultReference, route: IRoute, work: IWork): ICompletedResultReference {
  const locator = reference.locator;
  work.operands.add(locator);
  void route;
  const observed = new Proxy(reference, { get(target, property, receiver): unknown {
    if (property === 'locator' && work.active) { work.locators += 1; }
    return Reflect.get(target, property, receiver);
  } });
  work.references.set(observed, locator);
  return observed;
}

/**
 * Fresh real owner assembly. Candidate edits are explicit contractual-port
 * faults; the durable store and every unmodified operation remain authoritative.
 */
function openProof(size: number) {
  resetWorld(createWorld(Array.from({ length: size }, (_, index) => ({
    key: `person:${String(index).padStart(2, '0')}`, id: String(index), login: 'equal', authored: 1, score: 1, bio: 'unread',
  }))));
  const fixture = composeFold();
  const history = openHistory({ location: freshLocation() });
  const acquired = history.acquireWriter({ holder: 'fold-reference-proof', leaseMilliseconds: 60_000 });
  if (acquired.kind !== 'acquired') { throw new Error('Expected writer lease'); }
  const publication: IWork = { locators: 0, comparisons: 0, active: false, operands: new Set(), references: new WeakMap() };
  const validation: IWork = { locators: 0, comparisons: 0, active: false, operands: new Set(), references: new WeakMap() };
  const stages: IStageRequest[] = [];
  const reads: string[] = [];
  const published: ICompletedResultReference[] = [];
  let edit: (candidate: ICompletedEnvelope) => ICompletedEnvelope = (candidate) => candidate;
  let readFault: (reference: ICompletedResultReference) => void = () => undefined;
  const authority: IDurableHistory = {
    ...history,
    stageAttempt(lease, request) { stages.push(request); return history.stageAttempt(lease, request); },
    publishAttempt(lease, attemptId) {
      const reference = observedReference(history.publishAttempt(lease, attemptId), 'uniqueReferences', publication);
      published.push(reference);
      return reference;
    },
    findCandidates(subject) {
      return history.findCandidates(subject).map((candidate) => subject.subject === reportSubject
        // Native adapters can return foreign-realm arrays whose mapped arrays
        // inherit an unobserved some(). A local ordinary array preserves real
        // reference values/order while keeping descendant searches observable.
        ? edit({ ...candidate, dependencies: Array.from(candidate.dependencies, (reference) => observedReference(reference, 'evaluateFoldCandidate', validation)) })
        : candidate);
    },
    readEnvelope(reference) { reads.push(reference.locator); readFault(reference); return history.readEnvelope(reference); },
  };
  const host = createNodeMachine();
  const resolution = createResolution({ declarations: fixture.builders, composition: fixture.composition,
    bindings: { inputs: ['config'], helpers: ['discover', 'discoveryFinal', 'meets', 'summarize', 'render', 'renderIncluded', 'renderReadingSkipped', 'renderThrowing'] },
    environment: 'fold-reference-proof', history: authority, host, tracking: createTrackingObserver(host),
    admission: { admit: () => ({ kind: 'admitted' }) },
  });
  return {
    history, stages, reads, published, publication, validation,
    edit(candidateEdit: typeof edit): void { edit = candidateEdit; },
    fault(fault: typeof readFault): void { readFault = fault; },
    async run(key: string) { return resolution.resolveFold({ step: fixture.report, requestKey: key, lease: acquired.lease }); },
    candidate(): ICompletedEnvelope {
      const candidate = history.findCandidates({ analysis, environment: 'fold-reference-proof', subject: reportSubject, version: 1 })[0];
      if (candidate === undefined) { throw new Error('Expected published fold'); }
      return candidate;
    },
    close(): void { history.releaseWriter(acquired.lease); history.close(); },
  };
}

/** Successful publication/reuse is required independently of all work counters. */
function success(report: Awaited<ReturnType<ReturnType<typeof openProof>['run']>>, kind: 'published' | 'reused'): ICompletedResultReference {
  expect(report.outcome.kind).toBe(kind);
  if (report.outcome.kind !== 'published' && report.outcome.kind !== 'reused') { throw new Error('Expected successful fold'); }
  return report.outcome.reference;
}

// Finite-pass allowance, selected before runtime changes: publication permits
// two locator reads for deduplication, two for provenance/materialization, and
// two for durable staging per member, plus four fixed discovery/fold reads.
// Validation observes only candidate dependency references: one indexing pass
// and one spare boundary pass. Either route permits at most two predicate
// visits per member. Classification uses saved metadata, never counted reads.
test.each([8, 32])('fold publication preserves N=%i equal-payload distinct references with bounded exact-reference work', async (size) => {
  const proof = openProof(size);
  try {
    const report = await observeSearch('uniqueReferences', proof.publication, () => proof.run('publish'));
    const reference = success(report, 'published');
    const candidate = proof.candidate();
    expect(reference).toEqual(candidate.reference);
    expect(candidate.dependencies).toHaveLength(size);
    expect(new Set(candidate.dependencies.map((entry) => entry.locator)).size).toBe(size);
    const stage = proof.stages.at(-1);
    expect(stage?.dependencies).toHaveLength(size);
    expect(stage?.dependencies).toEqual(proof.published.slice(1, -1));
    for (const [index, dependency] of (stage?.dependencies ?? []).entries()) {
      expect(dependency).toBe(proof.published[index + 1]);
      expect(proof.history.reader.readSubtree(dependency, [])).toEqual({ label: '@equal', score: 1 });
    }
    expect(proof.publication.locators).toBeGreaterThan(0);
    expect(proof.publication.locators).toBeLessThanOrEqual(6 * size + 4);
    expect(proof.publication.comparisons).toBeLessThanOrEqual(2 * size);
  } finally { proof.close(); }
});

test.each([8, 32])('retained fold validation checks every N=%i historical member with bounded dependency search', async (size) => {
  const proof = openProof(size);
  try {
    const reference = success(await proof.run('cold'), 'published');
    const candidate = proof.candidate();
    proof.reads.length = 0;
    const report = await observeSearch('evaluateFoldCandidate', proof.validation, () => proof.run('warm'));
    expect(success(report, 'reused')).toEqual(reference);
    expect(proof.reads.filter((locator) => candidate.dependencies.some((entry) => entry.locator === locator))).toEqual(candidate.dependencies.map((entry) => entry.locator));
    expect(proof.validation.locators).toBeGreaterThan(0);
    expect(proof.validation.locators).toBeLessThanOrEqual(2 * size);
    expect(proof.validation.comparisons).toBeLessThanOrEqual(2 * size);
  } finally { proof.close(); }
});
