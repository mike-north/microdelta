/**
 * Restricted acquisition protocol tests inspect query/cursor and capture
 * authority using inert owner ports. Their returned source metadata is fixture
 * data, not a History publication or a qualified traversal result.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

import { describe, expect, test } from '@jest/globals';
import type { ITraversalBinding } from '@microdelta/definition';
import { createTrackingObserver } from '@microdelta/tracking';
import type { ITrackingObserverHost } from '@microdelta/tracking';

import type { IResolutionOutcome } from '../src/contracts.js';
import { createRootAcquisition, readRequestSourceEvidence } from '../src/root-acquisition.js';

/** This fixture owns mechanics only; current source policy is outside this isolated protocol. */
const host: ITrackingObserverHost = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  sha256(input: string): string { return createHash('sha256').update(input).digest('hex'); },
};

/** A fixed declared acquisition relationship, independently tested by Definition. */
const binding: ITraversalBinding = {
  slot: 'person-prs', query: { scope: 'test', role: 'input', slot: 'query' },
  page: { scope: 'test', role: 'callable', slot: 'page' },
  collection: { scope: 'test', role: 'step', slot: 'frontier' },
  template: 'prs', fold: { scope: 'test', role: 'step', slot: 'summary' },
};

/** The protocol exposes no callable slot parameter for an author to substitute. */
function fixture() {
  const owner = {};
  const composition = {};
  const captured: (readonly unknown[])[] = [];
  const observer = createTrackingObserver(host);
  let current: object | undefined = owner;
  let sequence = 0;
  const snapshot = (value: object): object => {
    const owned = observer.tracked(value, { path: ['fixture-snapshot'] });
    return observer.capture(() => observer.snapshotOutput(owned)).value;
  };
  const controller = createRootAcquisition({
    composition, binding, owner,
    authority: { currentOwner: () => current, assertRoot: () => undefined },
    query: () => ({ person: 'fixture/person', query: 'fixed' }), snapshot,
    acquire: async (_request, values): Promise<IResolutionOutcome> => {
      captured.push(values);
      sequence += 1;
      return { kind: 'published', step: binding.page, reference: { kind: 'completed-result', locator: `fixture:${String(sequence)}` }, attemptId: sequence, misses: [], trace: [], diagnostics: [] };
    },
    read: () => ({ continuation: 'next', advertised: 'page-data' }),
  });
  const request = { requestKey: 'page-one', lease: { holder: 'fixture', fence: 1, expiresAt: 30_000 } };
  return { controller, composition, captured, request, foreign(): void { current = {}; } };
}

describe('restricted root acquisition protocol', () => {
  test('derives query from its fixed binding and continuation only from the accepted predecessor', async () => {
    const run = fixture();
    const first = await run.controller.acquire(run.request);
    if (first.kind !== 'accepted') { throw new Error('Expected accepted source metadata'); }
    expect(run.captured).toEqual([[{ person: 'fixture/person', query: 'fixed' }, undefined]]);
    expect(() => run.controller.continuation({ ...first.page }, ['continuation'])).toThrow();
    const next = run.controller.continuation(first.page, ['continuation']);
    await run.controller.acquire({ ...run.request, requestKey: 'page-two', continuation: next });
    expect(run.captured[1]).toEqual([{ person: 'fixture/person', query: 'fixed' }, 'next']);
    expect(() => run.controller.continuation(first.page, ['continuation'])).toThrow();
    await expect(run.controller.acquire({ ...run.request, requestKey: 'bad-root' })).rejects.toThrow();
    await expect(run.controller.acquire({ ...run.request, requestKey: 'reused-cursor', continuation: next })).rejects.toThrow();
    expect(run.captured).toHaveLength(2);
  });

  test('binds a captured frontier to composition, original request and strict fold', async () => {
    const run = fixture();
    const result = await run.controller.acquire(run.request);
    if (result.kind !== 'accepted') { throw new Error('Expected accepted source metadata'); }
    const offered = run.controller.offer(result.page, { members: [{ id: 'A' }], status: 'open' });
    const evidence = run.controller.capture(offered, 'consumer');
    expect(readRequestSourceEvidence(evidence, run.composition, 'consumer', binding.fold).value).toEqual({ members: [{ id: 'A' }], status: 'open' });
    expect(() => readRequestSourceEvidence({ ...evidence }, run.composition, 'consumer', binding.fold)).toThrow();
    expect(() => readRequestSourceEvidence(evidence, {}, 'consumer', binding.fold)).toThrow();
    expect(() => readRequestSourceEvidence(evidence, run.composition, 'another', binding.fold)).toThrow();
    expect(() => readRequestSourceEvidence(evidence, run.composition, 'consumer', binding.collection)).toThrow();
    run.controller.stop();
    expect(readRequestSourceEvidence(evidence, run.composition, 'consumer', binding.fold).value).toEqual({ members: [{ id: 'A' }], status: 'open' });
    run.controller.dispose();
    expect(() => readRequestSourceEvidence(evidence, run.composition, 'consumer', binding.fold)).toThrow();
  });

  test('healthy terminal closure allows its current capture but refuses another page or terminal', async () => {
    const run = fixture();
    const result = await run.controller.acquire(run.request);
    if (result.kind !== 'accepted') { throw new Error('Expected accepted source metadata'); }
    const offered = run.controller.offer(result.page, { members: [], status: 'complete' });
    run.controller.complete();
    expect(run.controller.capture(offered, 'closed-consumer').kind).toBe('request-source-evidence');
    expect(() => run.controller.complete()).toThrow();
    await expect(run.controller.acquire(run.request)).rejects.toThrow();
    run.foreign();
    expect(() => run.controller.capture(offered, 'wrong-invocation')).toThrow();
    expect(run.captured).toHaveLength(1);
  });
});
