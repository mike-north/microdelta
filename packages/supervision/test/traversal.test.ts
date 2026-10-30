/**
 * Run entry and lifetime controls use refused or inert accepted injected
 * Resolution page scripts. They execute no provider, source body, History
 * publication or complete traversal. Definition supplies the genuine witness;
 * accepted-page sentinels stay confined to the injected owner-port double.
 */
import { describe, expect, test } from '@jest/globals';
import { declarations } from '@microdelta/definition';
import type { IBindingFamily, ICollectionResult } from '@microdelta/definition';
import { ResolutionError } from '@microdelta/resolution';
import type { IAcquiredPage, IFrontierOffer, IRequestSourceEvidence, ITraversalPageOutcome } from '@microdelta/resolution';

import { createStopController, createSupervision } from '../src/index.js';
import type { IResolutionPorts, IRun, ITraversalAdapter } from '../src/index.js';
import { codeOf, deferred, grantingWriter, nodeScopes, optionsFor, portDouble, settle } from './support.js';

/** Genuine relationship correspondence is shared by refused and inert accepted owner-port scripts. */
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

/** Faults are injected only at owner ports; their original values must cross rejection unchanged. */
interface IPortFaults {
  readonly acquisition?: { readonly error: unknown };
  readonly consumer?: { readonly error: unknown };
}

/** A port-only script proves ownership and failure routing, never a History publication. */
function fixture(faults: IPortFaults = {}) {
  const graph = relationship();
  const double = portDouble();
  const pending = deferred<void>();
  let ports: IResolutionPorts | undefined;
  const events: string[] = [];
  let hold = false;
  const unused = (): never => { throw new Error('A refused page cannot reach this operation'); };
  const adapter: ITraversalAdapter = { accept: () => ({ kind: 'complete', frontier: {} }) };
  // These narrow nominal sentinels live only in this injected protocol double.
  // No production registry recognizes them and no History result is published;
  // they let the owner test reach a rejecting consumer after its closed-page ACK.
  const reference = { kind: 'completed-result' as const, locator: 'inert-owner-port-page' };
  const page = Object.freeze({ kind: 'acquired-page' as const, reference, data: {} }) as IAcquiredPage;
  const offer = Object.freeze({ kind: 'frontier-offer' as const }) as IFrontierOffer;
  const evidence = Object.freeze({ kind: 'request-source-evidence' as const }) as IRequestSourceEvidence;
  const options = optionsFor(double, {
    writer: { ...grantingWriter, release: () => { events.push('writer-release'); } },
    resolution: supplied => {
      ports = supplied;
      return {
        ...double.factory(supplied),
        resolveFold: async () => {
          events.push('consumer');
          if (faults.consumer !== undefined) { throw faults.consumer.error; }
          return unused();
        },
        traversals: {
          open: witness => {
            expect(witness).toBe(graph.witness);
            events.push('open');
            return {
              binding: graph.binding,
              acquire: async (): Promise<ITraversalPageOutcome> => {
                events.push('acquire');
                if (hold) { await pending.promise; }
                events.push('settled');
                if (faults.acquisition !== undefined) { throw faults.acquisition.error; }
                if (faults.consumer !== undefined) {
                  return { kind: 'accepted', page, outcome: { kind: 'published', reference, step: graph.binding.page, attemptId: 1, misses: [], trace: [], diagnostics: [] } };
                }
                return { kind: 'refused', outcome: { kind: 'refused', disposition: 'denied', step: graph.binding.page, refused: graph.binding.page, reason: 'owner fixture refuses', misses: [], trace: [], diagnostics: [] } };
              },
              continuation: unused,
              offer: () => { events.push('offer'); return offer; },
              capture: () => { events.push('capture'); return evidence; },
              complete: () => { events.push('complete'); },
              stop: () => { events.push('stop'); },
              dispose: () => { events.push('controller-dispose'); },
            };
          },
          dispose: () => { events.push('port-dispose'); },
        },
      };
    },
  });
  return { graph, options, adapter, events, pending, hold(): void { hold = true; }, ports(): IResolutionPorts { if (ports === undefined) { throw new Error('Run not entered'); } return ports; } };
}

describe('restricted traversal run entry and lifetime', () => {
  test.each(['', undefined, null, 0, {}])('rejects malformed original request key %p before acquisition, writer or adapter activity', async invalid => {
    const setup = fixture();
    let acquisitions = 0; let adaptations = 0;
    // Ordinary JavaScript can replace a typed object's property; this exercises the runtime boundary without a cast.
    const request = Object.defineProperty({ requestKey: 'placeholder' }, 'requestKey', { value: invalid });
    const writer = { ...grantingWriter, tryLease: () => { acquisitions += 1; return grantingWriter.tryLease(); } };
    const adapter: ITraversalAdapter = { accept: () => { adaptations += 1; return { kind: 'complete', frontier: {} }; } };
    await createSupervision({ context: nodeScopes }).run({ ...setup.options, writer }, async run => {
      const error = await run.traverse(setup.graph.witness, adapter, request).then(() => undefined, (cause: unknown) => cause);
      expect(setup.events).toEqual([]);
      expect(acquisitions).toBe(0); expect(adaptations).toBe(0);
      expect(error).toMatchObject({ code: 'invalid-request' });
    });
    // Ordinary run disposal remains required even when no request acquired authority.
    expect(setup.events).toEqual(['port-dispose']);
  });

  test('captures one original request key before deriving acquisition and frontier identities', async () => {
    const cause = { fixture: 'consumer fault preserves original identity' };
    const setup = fixture({ consumer: { error: cause } });
    let reads = 0;
    const request = { get requestKey(): string { reads += 1; return `opaque:${reads}`; } };
    await expect(createSupervision({ context: nodeScopes }).run(setup.options, run =>
      run.traverse(setup.graph.witness, setup.adapter, request))).rejects.toBe(cause);
    expect(reads).toBe(1);
    expect(setup.events).toContain('acquire'); expect(setup.events).toContain('capture');
  });

  test('supplies root authority only in its live run and refuses member/root misuse before opening', async () => {
    const setup = fixture();
    const supervisor = createSupervision({ context: nodeScopes });
    await supervisor.run(setup.options, async run => {
      const authority = setup.ports().traversalAuthority;
      expect(authority.currentOwner()).toBeDefined();
      expect(() => authority.assertRoot()).not.toThrow();
      await setup.ports().execution.member(async () => {
        expect(() => authority.assertRoot()).toThrow();
        expect(await codeOf(run.traverse(setup.graph.witness, setup.adapter, { requestKey: 'nested' }))).toBe('undeclared-call');
      });
      await supervisor.run(optionsFor(portDouble(), { runId: 'decoy' }), async () => {
        expect(authority.currentOwner()).toBeUndefined();
        expect(() => authority.assertRoot()).toThrow();
        expect(await codeOf(run.traverse(setup.graph.witness, setup.adapter, { requestKey: 'foreign' }))).toBe('outside-run');
      });
      expect(setup.events).toEqual([]);
    });
    expect(setup.ports().traversalAuthority.currentOwner()).toBeUndefined();
    expect(() => setup.ports().traversalAuthority.assertRoot()).toThrow();
    expect(setup.events).toEqual(['port-dispose', 'writer-release']);
  });

  test('an unawaited page stays owned until settled, then disposes before writer release', async () => {
    const setup = fixture();
    setup.hold();
    const supervisor = createSupervision({ context: nodeScopes });
    let escaped: IRun | undefined;
    let terminal: Promise<unknown> | undefined;
    let closed = false;
    const running = supervisor.run(setup.options, run => {
      escaped = run;
      terminal = run.traverse(setup.graph.witness, setup.adapter, { requestKey: 'person' });
    }).then(() => { closed = true; });
    await settle();
    expect(setup.events).toEqual(['open', 'acquire']);
    expect(closed).toBe(false);
    setup.pending.resolve();
    await running;
    await expect(terminal).resolves.toMatchObject({ kind: 'discovery-failed' });
    expect(setup.events).toEqual(['open', 'acquire', 'settled', 'stop', 'controller-dispose', 'port-dispose', 'writer-release']);
    if (escaped === undefined) { throw new Error('Expected escaped run'); }
    expect(await codeOf(escaped.traverse(setup.graph.witness, setup.adapter, { requestKey: 'late' }))).toBe('run-closed');
    expect(setup.events.filter(event => event === 'open')).toHaveLength(1);
  });

  test('existing stop refuses traversal before Resolution, writer or adapter authority', async () => {
    const setup = fixture();
    const stop = createStopController();
    stop.request({ level: 'soft' });
    await createSupervision({ context: nodeScopes }).run({ ...setup.options, stop }, async run => {
      expect(await codeOf(run.traverse(setup.graph.witness, setup.adapter, { requestKey: 'stopped' }))).toBe('stopped');
      expect(setup.events).toEqual([]);
    });
  });

  test.each([
    new ResolutionError('integrity', 'fixture History evidence failure'),
    new ResolutionError('admission-failure', 'fixture admission port failure'),
    { fixture: 'opaque host or lease fault' },
    undefined,
  ])('acquisition infrastructure rejection keeps original identity and ordinary run rejection (%p)', async error => {
    const setup = fixture({ acquisition: { error } });
    const stop = createStopController();
    await expect(createSupervision({ context: nodeScopes }).run({ ...setup.options, stop }, run =>
      run.traverse(setup.graph.witness, setup.adapter, { requestKey: 'infrastructure' }))).rejects.toBe(error);
    expect(stop.state.level).toBe('none');
    expect(setup.events).toEqual(['open', 'acquire', 'settled', 'stop', 'controller-dispose', 'port-dispose', 'writer-release']);
  });

  test('a rejecting consumer after healthy acquisition closure rejects with its original fault', async () => {
    const error = { fixture: 'consumer History failure after closed acquisition' };
    const setup = fixture({ consumer: { error } });
    const stop = createStopController();
    await expect(createSupervision({ context: nodeScopes }).run({ ...setup.options, stop }, run =>
      run.traverse(setup.graph.witness, setup.adapter, { requestKey: 'consumer-fault' }))).rejects.toBe(error);
    expect(stop.state.level).toBe('none');
    expect(setup.events).toEqual(['open', 'acquire', 'settled', 'offer', 'complete', 'capture', 'consumer', 'stop', 'controller-dispose', 'port-dispose', 'writer-release']);
  });

  test('a source-attributable acquisition failure retains its typed producer terminal and selected soft stop', async () => {
    const error = new ResolutionError('execution-failure', 'fixture source check failed');
    const setup = fixture({ acquisition: { error } });
    const stop = createStopController();
    const result = await createSupervision({ context: nodeScopes }).run({ ...setup.options, stop }, run =>
      run.traverse(setup.graph.witness, setup.adapter, { requestKey: 'producer-fault' }));
    expect(result.value).toEqual({ kind: 'discovery-failed', error });
    expect(stop.state.level).toBe('soft');
    expect(setup.events).toEqual(['open', 'acquire', 'settled', 'stop', 'controller-dispose', 'port-dispose', 'writer-release']);
  });
});
