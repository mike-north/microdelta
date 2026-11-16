/**
 * Coordinator scheduling controls stop at injected Resolution owner ports. They
 * use genuine frozen Definition correspondence, but acquire no provider data,
 * publish no History result and supply no campaign or real-traversal evidence.
 */
import { describe, expect, test } from '@jest/globals';

import { declarations } from '@microdelta/definition';
import type { IBindingFamily, ICollectionResult } from '@microdelta/definition';
import { ResolutionError } from '@microdelta/resolution';
import type { IAcquiredPage, IFoldRequest, IFoldResolution, IFrontierOffer, IRequestSourceEvidence, ITraversalContinuation, ITraversalPageOutcome } from '@microdelta/resolution';

import { SupervisionError, createStopController, createSupervision } from '../src/index.js';
import type { IResolutionPorts, ITraversalAdapter } from '../src/index.js';
import { admissionFor, deferred, fakeTimer, grantingWriter, nodeScopes, optionsFor, portDouble, settle, stepOf } from './support.js';
import { operationPorts } from './traversal-operation-ports.js';

/** Genuine declared correspondence fixes the only page, collection, member and strict-fold roles. */
function relationship() {
  const builders = declarations<IBindingFamily>();
  const page = builders.sourceSlot<readonly [object, string | undefined], object>({ slot: 'page' });
  const source = builders.suppliedSource<readonly [object, string | undefined], object>({ run: () => ({}) });
  const collection = builders.source<ICollectionResult<{ readonly id: string }>>({ subject: 'frontier', collection: { identity: 'id' }, run: () => ({ members: [], status: 'open' }) });
  const template = builders.template({ slot: 'prs', collection, steps: member => ({ assess: member.memo({ subject: member.subject('assess'), run: () => ({}) }) }) });
  const fold = builders.fold({ subject: 'summary', over: { template, step: 'assess' }, run: () => ({}) });
  const traversal = builders.traversal({ slot: 'person-prs', query: 'query', page, collection, template, fold });
  const composition = builders.compose({ scope: 'analysis:test', inputs: [{ slot: 'query', value: {} }], templates: [template], traversals: [traversal], steps: [{ slot: 'frontier', declaration: collection }, { slot: 'summary', declaration: fold }], supplied: [builders.supplySource({ slot: page, declaration: source, subject: () => 'page' })] });
  const witness = builders.rootAcquisition(composition, traversal);
  return { witness, binding: builders.resolveRootAcquisition(composition, witness) };
}

/** Only this protocol double recognizes these nominal sentinels; production registries and persistence cannot accept them. */
function pageAt(ordinal: number): IAcquiredPage {
  return Object.freeze({ kind: 'acquired-page' as const, reference: { kind: 'completed-result' as const, locator: 'inert-page:' + String(ordinal) }, data: { ordinal } }) as IAcquiredPage;
}
/** Each gate acknowledges actual entry into the owner port, never an elapsed timer. */
type IPageAction = { readonly kind: 'accepted' } | { readonly kind: 'refused' } | { readonly kind: 'throws'; readonly error: unknown };
/** A captured frame cannot become the latest offer or another request's evidence. */
interface IFrame { readonly ordinal: number; readonly complete: boolean; readonly normalRequestKey: string }
/** Scripts select owner-port faults and bounds, not provider behavior or fake durable results. */
interface IFixtureOptions {
  readonly pages?: 1 | 2 | 3;
  readonly blockConsumers?: boolean;
  readonly busyWriterAfterPageTwo?: boolean;
  readonly writerFaultAfterPageTwo?: { readonly error: unknown };
  readonly consumerFault?: { readonly error: unknown };
  readonly resumeFirstConsumer?: boolean;
  readonly closedOutcome?: 'waiting' | 'failed';
  readonly stopWhenClosed?: 'soft' | 'hard';
}

/** A controlled producer and consumer expose scheduling/drain facts while every domain owner is a port boundary. */
function fixture(settings: IFixtureOptions = {}) {
  const graph = relationship(); const double = portDouble(); const events: string[] = [];
  const secondHeld = deferred<void>(); const thirdHeld = deferred<void>();
  const second = deferred<IPageAction>(); const third = deferred<IPageAction>();
  const firstConsumer = deferred<void>(); const lastConsumer = deferred<void>();
  const timer = fakeTimer();
  const supervisor = createSupervision({ context: nodeScopes, timer });
  const stop = createStopController();
  const captured: IFrame[] = []; const consumerRequests: IFoldRequest[] = [];
  const counts = { pages: 0, consumers: 0, peakPages: 0, peakConsumers: 0 };
  const offers = new WeakMap<object, Omit<IFrame, 'normalRequestKey'>>(); const captures = new WeakMap<object, IFrame>();
  let latest: object | undefined; let ordinal = 0; let ports: IResolutionPorts | undefined; let stopped = false; let disposed = false; let pageTwoEntered = false; let busy = true; let transportCalls = 0;
  const adapter: ITraversalAdapter = { accept: data => {
    const number: unknown = Reflect.get(data, 'ordinal');
    if (typeof number !== 'number') { throw new Error('Missing inert page ordinal'); }
    const complete = number === (settings.pages ?? 2); const frontier = Object.freeze({ ordinal: number, complete });
    return complete ? { kind: 'complete', frontier } : { kind: 'continue', frontier, continuation: ['next'] };
  } };
  const options = optionsFor(double, {
    stop,
    ...(settings.resumeFirstConsumer === true ? { operations: operationPorts(), deferral: 'sleep' as const } : {}),
    writer: {
      tryLease: () => {
        if (pageTwoEntered && settings.writerFaultAfterPageTwo !== undefined) { events.push('writer-fault'); throw settings.writerFaultAfterPageTwo.error; }
        if (pageTwoEntered && settings.busyWriterAfterPageTwo === true && busy) { events.push('writer-held'); return { kind: 'held', holder: 'other', expiresAt: Number.MAX_SAFE_INTEGER }; }
        return grantingWriter.tryLease();
      },
      release: () => { events.push('writer-release'); },
    },
    resolution: supplied => {
      ports = supplied;
      return {
        ...double.factory(supplied),
        resolveFold: async (request: IFoldRequest): Promise<IFoldResolution> => {
          const frame = request.sourceEvidence === undefined ? undefined : captures.get(request.sourceEvidence);
          if (frame === undefined || frame.normalRequestKey !== request.normalRequestKey) { throw new Error('Missing or foreign inert captured frontier'); }
          consumerRequests.push(request); counts.consumers += 1; counts.peakConsumers = Math.max(counts.peakConsumers, counts.consumers);
          events.push('consumer:' + String(frame.ordinal));
          try {
            if (settings.blockConsumers === true) { await (frame.ordinal === 1 ? firstConsumer.promise : lastConsumer.promise); }
            if (settings.consumerFault !== undefined) { throw settings.consumerFault.error; }
            if (settings.resumeFirstConsumer === true && frame.ordinal === 1) {
              const step = stepOf('assess', 'A'); const admission = admissionFor(step);
              const decision = await supplied.admission.admit(admission);
              if (decision.kind === 'admitted') {
                const executed = await supplied.execution.execute(step, async () => {
                  await supervisor.execution().operation({ name: 'current-member', binding: 'stable-current-facts', retry: { maxAttempts: 2 }, perform: () => {
                    transportCalls += 1;
                    return Promise.resolve(transportCalls === 1 ? { kind: 'rate-limited', retryAt: timer.currentEpochMilliseconds() + 1000 } : { kind: 'succeeded', value: 1 });
                  } }).catch(() => undefined);
                }, { subject: admission.subject, attemptId: consumerRequests.length });
                if (executed.kind === 'threw') { throw executed.error; }
              }
            }
            const common = { step: request.step, misses: [], trace: [], diagnostics: [] };
            return {
              over: { scope: graph.binding.fold.scope, role: 'step', slot: 'assess', template: graph.binding.template, collection: graph.binding.collection.slot },
              discovery: { kind: 'keyed', collection: graph.binding.collection, reference: { kind: 'completed-result', locator: 'inert-collection' }, completion: frame.complete ? 'complete' : 'open', keys: [] },
              members: [],
              // Open empty discovery waits. A closed empty collection can be
              // ready while ordinary policy denies its fold: neither is success.
              outcome: !frame.complete || settings.closedOutcome === 'waiting'
                ? { ...common, kind: 'waiting', pending: [], openDiscovery: !frame.complete }
                : settings.closedOutcome === 'failed'
                  ? { ...common, kind: 'failed', failed: ['A'], cancelled: [], pending: [], openDiscovery: false, diagnostic: 'owner-port member failed' }
                  : { ...common, kind: 'refused', disposition: 'denied', refused: request.step, reason: 'inert fold policy denies' },
              diagnostics: [],
            };
          } finally { counts.consumers -= 1; events.push('consumer-settled:' + String(frame.ordinal)); }
        },
        traversals: {
          open: witness => {
            expect(witness).toBe(graph.witness);
            return {
              binding: graph.binding,
              acquire: async (): Promise<ITraversalPageOutcome> => {
                ordinal += 1; const number = ordinal; counts.pages += 1; counts.peakPages = Math.max(counts.peakPages, counts.pages); events.push('page:' + String(number));
                try {
                  let action: IPageAction = { kind: 'accepted' };
                  if (number === 2) { pageTwoEntered = true; events.push('page-two-held'); secondHeld.resolve(); action = await second.promise; }
                  if (number === 3) { events.push('page-three-held'); thirdHeld.resolve(); action = await third.promise; }
                  if (action.kind === 'throws') { throw action.error; }
                  if (action.kind === 'refused') { return { kind: 'refused', outcome: { kind: 'refused', disposition: 'denied', step: graph.binding.page, refused: graph.binding.page, reason: 'inert producer refusal', misses: [], trace: [], diagnostics: [] } }; }
                  const page = pageAt(number); return { kind: 'accepted', page, outcome: { kind: 'published', reference: page.reference, step: graph.binding.page, attemptId: number, misses: [], trace: [], diagnostics: [] } };
                } finally { counts.pages -= 1; events.push('page-settled:' + String(number)); }
              },
              continuation: (): ITraversalContinuation => Object.freeze({ kind: 'traversal-continuation' as const }) as ITraversalContinuation,
              offer: (page: IAcquiredPage, frontier: object): IFrontierOffer => {
                if (stopped || disposed) { throw new ResolutionError('invalid-request', 'Stopped inert producer'); }
                const number: unknown = Reflect.get(page.data, 'ordinal');
                if (typeof number !== 'number') { throw new Error('Missing inert ordinal'); }
                const frame = Object.freeze({ ordinal: number, complete: Reflect.get(frontier, 'complete') === true });
                const offer = Object.freeze({ kind: 'frontier-offer' as const }) as IFrontierOffer; offers.set(offer, frame); latest = offer; events.push('offer:' + String(number)); return offer;
              },
              capture: (offer: IFrontierOffer, normalRequestKey: string): IRequestSourceEvidence => {
                if (stopped || disposed || latest !== offer) { throw new ResolutionError('invalid-request', 'Stopped or superseded inert capture'); }
                supplied.traversalAuthority.assertRoot();
                const offered = offers.get(offer); if (offered === undefined) { throw new Error('Foreign inert offer'); }
                const frame = Object.freeze({ ...offered, normalRequestKey }); captured.push(frame);
                const token = Object.freeze({ kind: 'request-source-evidence' as const }) as IRequestSourceEvidence; captures.set(token, frame); events.push('capture:' + String(frame.ordinal)); return token;
              },
              complete: (): void => { events.push('producer-complete'); if (settings.stopWhenClosed !== undefined) { stop.request({ level: settings.stopWhenClosed }); } },
              stop: (): void => { stopped = true; events.push('producer-stop'); },
              dispose: (): void => { disposed = true; events.push('producer-dispose'); },
            };
          },
          dispose: (): void => { events.push('port-dispose'); },
        },
      };
    },
  });
  return {
    graph, options, adapter, events, captured, consumerRequests, counts, stop, timer, supervisor, secondHeld, thirdHeld, second, third, firstConsumer, lastConsumer,
    transportCalls: (): number => transportCalls,
    releaseWriter: (): void => { busy = false; timer.advance(1000); },
    cleanup: (): void => { stop.request({ level: 'hard' }); busy = false; second.resolve({ kind: 'accepted' }); third.resolve({ kind: 'accepted' }); firstConsumer.resolve(); lastConsumer.resolve(); timer.advance(1000); },
    ports: (): IResolutionPorts => { if (ports === undefined) { throw new Error('Run not entered'); } return ports; },
  };
}

/** Rejection values stay explicit, so thrown undefined cannot masquerade as an absent failure. */
function running(value: ReturnType<typeof fixture>, unawaited = false) {
  let terminal: Promise<unknown> | undefined;
  const promise = value.supervisor.run(value.options, run => {
    terminal = run.traverse(value.graph.witness, value.adapter, { requestKey: 'person' });
    return unawaited ? undefined : terminal;
  });
  const result = promise.then(value => ({ kind: 'returned' as const, value }), (error: unknown) => ({ kind: 'rejected' as const, error }));
  return { result, terminal: (): Promise<unknown> => { if (terminal === undefined) { throw new Error('Run not entered'); } return terminal; } };
}

describe('bounded producer/consumer handoff at owner ports', () => {
  test('open F1 starts its consumer while the acknowledged second acquisition remains held', async () => {
    const value = fixture(); const work = running(value);
    try {
      await value.secondHeld.promise; await settle();
      expect(value.events).toContain('page-two-held'); expect(value.events).toContain('capture:1'); expect(value.events).toContain('consumer:1');
      expect(value.events).not.toContain('producer-complete'); expect(value.events).not.toContain('producer-dispose');
    } finally {
      // Release only assertion cleanup, never retroactive successful handoff.
      value.cleanup(); await work.result;
    }
  });

  test('F2 then closed F3 coalesce to one latest pending offer while F1 stays fixed and final denial stays denial', async () => {
    const value = fixture({ pages: 3, blockConsumers: true }); const work = running(value);
    try {
      await value.secondHeld.promise; await settle(); expect(value.events).toContain('consumer:1'); const first = value.captured[0];
      value.second.resolve({ kind: 'accepted' }); await value.thirdHeld.promise; value.third.resolve({ kind: 'accepted' }); await settle();
      expect(value.events).toContain('offer:2'); expect(value.events).toContain('offer:3'); expect(value.events).not.toContain('capture:2'); expect(value.events).not.toContain('capture:3');
      expect(first).toMatchObject({ ordinal: 1, complete: false }); expect(value.counts.peakPages).toBe(1); expect(value.counts.peakConsumers).toBe(1);
      value.firstConsumer.resolve(); await settle(); expect(value.events).toContain('capture:3'); expect(value.events).toContain('consumer:3'); expect(value.events).not.toContain('consumer:2');
      expect(value.captured[0]).toBe(first); expect(first).toMatchObject({ complete: false }); value.lastConsumer.resolve();
      expect(await work.result).toMatchObject({ kind: 'returned', value: { value: { kind: 'complete', report: { discovery: { completion: 'complete' }, outcome: { status: 'pending' } } } } });
      expect(value.counts.peakConsumers).toBe(1);
    } finally { value.cleanup(); await work.result; }
  });

  test('resumed F1 passes retain one capture while a closed F2 waits for that same consumer', async () => {
    const value = fixture({ resumeFirstConsumer: true }); const work = running(value);
    try {
      await value.secondHeld.promise; await settle(); expect(value.transportCalls()).toBe(1);
      const first = value.consumerRequests[0]; expect(first).toBeDefined();
      value.second.resolve({ kind: 'accepted' }); await settle(); expect(value.events).not.toContain('capture:2');
      const waits = value.timer.scheduled.filter(entry => !entry.cancelled && !entry.fired);
      expect(waits).toHaveLength(1); const wait = waits[0]; if (wait === undefined) { throw new Error('Missing actual owner deferral'); }
      // Classification can place the actual wait beyond the provider's floor.
      // This control advances the observed owner wait, not an invented delay.
      expect(wait.at).toBeGreaterThan(value.timer.currentEpochMilliseconds()); value.timer.advance(wait.at - value.timer.currentEpochMilliseconds()); await settle();
      const resumed = value.consumerRequests.filter(request => request.normalRequestKey === 'person/frontier:1');
      expect(resumed).toHaveLength(2); expect(resumed[0]?.sourceEvidence).toBe(resumed[1]?.sourceEvidence);
      expect(resumed[0]?.requestKey).not.toBe(resumed[1]?.requestKey); expect(value.captured.map(frame => frame.ordinal)).toEqual([1, 2]);
      expect(value.captured[0]).toMatchObject({ complete: false }); expect(value.transportCalls()).toBe(2);
      const result = await work.result; expect(result.kind).toBe('returned');
    } finally { value.cleanup(); await work.result; }
  });

  test.each(['waiting', 'failed'] as const)('healthy discovery closure retains the actual final %s fold report', async closedOutcome => {
    const value = fixture({ closedOutcome }); const work = running(value);
    try {
      await value.secondHeld.promise; await settle(); value.second.resolve({ kind: 'accepted' });
      expect(await work.result).toMatchObject({ kind: 'returned', value: { value: { kind: 'complete', report: { discovery: { completion: 'complete' }, outcome: { status: closedOutcome } } } } });
    } finally { value.cleanup(); await work.result; }
  });

  test('external soft stop drops the pending frontier without withdrawing an existing captured consumer', async () => {
    const value = fixture({ pages: 3, blockConsumers: true }); const work = running(value);
    try {
      await value.secondHeld.promise; await settle(); expect(value.events).toContain('consumer:1');
      value.second.resolve({ kind: 'accepted' }); await value.thirdHeld.promise; value.stop.request({ level: 'soft' }); value.third.resolve({ kind: 'accepted' }); await settle();
      expect(value.events).not.toContain('capture:2'); expect(value.events).not.toContain('offer:3'); expect(value.events).not.toContain('producer-dispose');
      value.firstConsumer.resolve(); expect(await work.result).toMatchObject({ kind: 'returned', value: { value: { kind: 'stopped', report: { outcome: { status: 'waiting' } } } } });
    } finally { value.cleanup(); await work.result; }
  });

  test.each(['soft', 'hard'] as const)('stop %s after the producer closes preserves stopped instead of treating open F1 as the final report', async level => {
    const value = fixture({ pages: 3, blockConsumers: true }); const work = running(value);
    try {
      await value.secondHeld.promise; await settle(); expect(value.events).toContain('consumer:1');
      value.second.resolve({ kind: 'accepted' }); await value.thirdHeld.promise; value.third.resolve({ kind: 'accepted' }); await settle();
      expect(value.events).toContain('producer-complete'); expect(value.events).not.toContain('capture:3');
      value.stop.request({ level }); value.firstConsumer.resolve();
      expect(await work.result).toMatchObject({ kind: 'returned', value: { value: { kind: 'stopped', report: { discovery: { completion: 'open' }, outcome: { status: 'waiting' } } } } });
      expect(value.events).not.toContain('capture:2'); expect(value.events).not.toContain('capture:3');
      expect(value.events.filter(event => event.startsWith('consumer:'))).toEqual(['consumer:1']);
    } finally { value.cleanup(); await work.result; }
  });

  test.each(['soft', 'hard'] as const)('a stopped first closed frontier before consumer admission reports stopped without inventing a prior report (%s)', async level => {
    const value = fixture({ pages: 1, stopWhenClosed: level }); const work = running(value);
    try {
      const result = await work.result;
      expect(result).toMatchObject({ kind: 'returned', value: { value: { kind: 'stopped' } } });
      if (result.kind === 'returned') { expect(result.value.value).not.toHaveProperty('report'); }
      expect(value.events).toContain('producer-complete'); expect(value.events).not.toContain('capture:1'); expect(value.consumerRequests).toHaveLength(0);
    } finally { value.cleanup(); await work.result; }
  });

  test('external first-lease soft stop stays an ordinary rejection, never this producer causal exception', async () => {
    const value = fixture({ busyWriterAfterPageTwo: true }); const work = running(value);
    try {
      await value.secondHeld.promise; await settle(); expect(value.events).toContain('writer-held'); value.stop.request({ level: 'soft' });
      value.second.resolve({ kind: 'refused' }); const result = await work.result; expect(result.kind).toBe('rejected');
      if (result.kind === 'rejected') { expect(result.error).toBeInstanceOf(SupervisionError); expect(result.error).toMatchObject({ code: 'stopped' }); }
      expect(value.events).not.toContain('consumer:1');
    } finally { value.cleanup(); await work.result; }
  });

  test('producer failure discards pending captures and drains an existing consumer before disposal', async () => {
    const value = fixture({ pages: 3, blockConsumers: true }); const work = running(value);
    try {
      await value.secondHeld.promise; await settle(); expect(value.events).toContain('consumer:1');
      value.second.resolve({ kind: 'accepted' }); await value.thirdHeld.promise; value.third.resolve({ kind: 'refused' }); await settle();
      expect(value.stop.state.level).toBe('soft'); expect(value.events).not.toContain('capture:2'); expect(value.events).not.toContain('producer-dispose');
      value.firstConsumer.resolve(); const result = await work.result;
      expect(result).toMatchObject({ kind: 'returned', value: { value: { kind: 'discovery-failed', report: { discovery: { completion: 'open' }, outcome: { status: 'waiting' } } } } });
      expect(value.events.indexOf('producer-dispose')).toBeGreaterThan(value.events.indexOf('consumer-settled:1'));
    } finally { value.cleanup(); await work.result; }
  });

  test('only this producer own soft stop can preserve its terminal over a consumer first-lease refusal', async () => {
    const value = fixture({ busyWriterAfterPageTwo: true }); const work = running(value);
    try {
      await value.secondHeld.promise; await settle(); expect(value.events).toContain('capture:1'); expect(value.events).toContain('writer-held'); expect(value.events).not.toContain('consumer:1');
      value.second.resolve({ kind: 'refused' });
      expect(await work.result).toMatchObject({ kind: 'returned', value: { value: { kind: 'discovery-failed' } } });
      expect(value.events).not.toContain('consumer:1'); expect(value.timer.scheduled.every(entry => entry.cancelled)).toBe(true);
    } finally { value.cleanup(); await work.result; }
  });

  test.each([undefined, new SupervisionError('stopped', 'A host can throw the identical stopped shape')])('independent first-lease host rejection remains exact (%p)', async error => {
    const value = fixture({ writerFaultAfterPageTwo: { error } }); const work = running(value);
    try {
      await value.secondHeld.promise; await settle(); expect(value.events).toContain('writer-fault'); expect(value.events).not.toContain('producer-dispose');
      value.second.resolve({ kind: 'refused' }); const result = await work.result;
      expect(result.kind).toBe('rejected'); if (result.kind === 'rejected') { expect(result.error).toBe(error); }
    } finally { value.cleanup(); await work.result; }
  });

  test.each([undefined, new SupervisionError('stopped', 'A consumer can throw the identical stopped shape')])('a genuine admitted consumer error wins over later producer failure (%p)', async error => {
    const value = fixture({ blockConsumers: true, consumerFault: { error } }); const work = running(value);
    try {
      await value.secondHeld.promise; await settle(); expect(value.events).toContain('consumer:1'); value.firstConsumer.resolve(); await settle();
      expect(value.events).not.toContain('producer-dispose'); value.second.resolve({ kind: 'refused' }); const result = await work.result;
      expect(result.kind).toBe('rejected'); if (result.kind === 'rejected') { expect(result.error).toBe(error); }
      expect(value.events).not.toContain('offer:2');
    } finally { value.cleanup(); await work.result; }
  });

  test.each([undefined, new SupervisionError('stopped', 'A stopped consumer body is still its own failure')])('earlier producer failure cannot mask a later genuine admitted consumer error (%p)', async error => {
    const value = fixture({ blockConsumers: true, consumerFault: { error } }); const work = running(value);
    try {
      await value.secondHeld.promise; await settle(); expect(value.events).toContain('consumer:1'); value.second.resolve({ kind: 'refused' }); await settle();
      expect(value.stop.state.level).toBe('soft'); expect(value.events).not.toContain('producer-dispose'); value.firstConsumer.resolve(); const result = await work.result;
      expect(result.kind).toBe('rejected'); if (result.kind === 'rejected') { expect(result.error).toBe(error); }
    } finally { value.cleanup(); await work.result; }
  });

  test.each([true, false])('two genuine owner faults retain explicit first-failure order, producer first=%p', async producerFirst => {
    const producerError = new ResolutionError('integrity', 'Independent producer infrastructure failure');
    const consumerError = undefined;
    const value = fixture({ blockConsumers: true, consumerFault: { error: consumerError } }); const work = running(value);
    try {
      await value.secondHeld.promise; await settle(); expect(value.events).toContain('consumer:1');
      if (producerFirst) { value.second.resolve({ kind: 'throws', error: producerError }); await settle(); value.firstConsumer.resolve(); }
      else { value.firstConsumer.resolve(); await settle(); value.second.resolve({ kind: 'throws', error: producerError }); }
      const result = await work.result; expect(result.kind).toBe('rejected');
      if (result.kind === 'rejected') { expect(result.error).toBe(producerFirst ? producerError : consumerError); }
      expect(value.events).toContain('page-settled:2'); expect(value.events).not.toContain('offer:2');
    } finally { value.cleanup(); await work.result; }
  });

  test('an unawaited traversal retains both owned tasks until the last consumer settles', async () => {
    const value = fixture({ blockConsumers: true }); const work = running(value, true);
    try {
      await value.secondHeld.promise; await settle(); expect(value.events).toContain('consumer:1'); value.second.resolve({ kind: 'refused' }); await settle();
      expect(value.events).not.toContain('producer-dispose'); expect(value.events).not.toContain('port-dispose');
      value.firstConsumer.resolve(); expect(await work.result).toMatchObject({ kind: 'returned' }); await expect(work.terminal()).resolves.toMatchObject({ kind: 'discovery-failed' });
      expect(value.events.indexOf('producer-dispose')).toBeGreaterThan(value.events.indexOf('consumer-settled:1')); expect(value.events.indexOf('port-dispose')).toBeGreaterThan(value.events.indexOf('producer-dispose'));
    } finally { value.cleanup(); await work.result; }
  });
});
