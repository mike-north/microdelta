/**
 * A flat one-person fixture authored through installed package imports and
 * generated alpha declarations. Every external request is an ordinary supervised
 * operation; collection publication, member keying, reuse and the strict fold
 * remain owned by the real library. Constructing this fixture starts no run.
 */
import { createHash } from 'node:crypto';

import { authoring } from '../../src/index.js';
import type { IOperationSharedRate, ISupervision } from '@microdelta/supervision';
import type { IAdmissionDecision, IAdmissionRequest, IAuthoring, IComposition, IFoldEntry, IOperationSend, IRunContext, IRunEvent, IRootAcquisitionWitness, ITrackedView, ITraversalAdapter } from '../../src/index.js';

import { adaptPage, fixedQuery } from './adapter.js';
import type { IFrontier, IPage, IPr } from './adapter.js';
import type { ITrace } from './trace.js';

/** All processes reopen the same logical store meaning; a pathname is only its physical location. */
export const logicalStore = 'store:within-person-fixed';
/** The one flat analysis scope is independent of page, frontier and private run ordinal. */
export const analysis = 'within-person:fixture-person-1';
/** Controlled acquisition and assessment share one ordinary environment and operation engine. */
export const environment = 'env:within-person-fixed';
/** Stable qualified PR identity survives movement among page responses. */
export const primaryMember = 'fixture/repo#101';

/** Actual source content separates consumed facts from an unread control field. */
interface ICurrent { readonly content: string; readonly revision: string; readonly unread: string }
/** One cold assessment returns only explicit consumed source facts. */
interface IAssessment { readonly id: string; readonly statement: string }
/** The local summary never performs an external operation. */
interface ISummary { readonly ids: readonly string[] }
/** Fixed query is composed before graph freeze; frontier evidence is a different binding. */
interface IInputs { readonly query: typeof fixedQuery }
/** Declared adapters reach controlled work, while orchestration stays outside author callbacks. */
interface IHelpers {
  /** Transport helpers share the callable namespace with the distinct supplied `page` root slot. */
  readonly fetchPage: (query: typeof fixedQuery, cursor: string | undefined) => Promise<IPage>;
  readonly current: (name: 'discussion' | 'detail', id: string | undefined) => Promise<ICurrent>;
  readonly assess: (id: string | undefined, discussion: string, detail: string) => Promise<IAssessment>;
  readonly collected: (frontier: IFrontier) => void;
  readonly summary: (entries: readonly IFoldEntry<ITrackedView<IAssessment>>[]) => ISummary;
  readonly invalid: () => never;
}

/** A finite promise gate has no timer-based success path. */
interface IGate<T> { readonly promise: Promise<T>; resolve(value: T): void }
/** Allocate one controlled acknowledgment gate; its owner decides when the condition actually occurs. */
function gate<T>(): IGate<T> {
  let finish: (value: T) => void = () => undefined;
  const promise = new Promise<T>(resolve => { finish = resolve; });
  return { promise, resolve: finish };
}

/** The fixture's only two advertised pages stay within the selected four-PR/three-page ceiling. */
function response(cursor: string | undefined): IPage {
  const members: readonly IPr[] = cursor === undefined
    ? [{ id: primaryMember, identity: 'node:A', number: 101 }]
    : [{ id: 'fixture/repo#102', identity: 'node:B', number: 102 }];
  return { query: fixedQuery, revision: 'fixture-r1', members, continuation: cursor === undefined ? 'page-2' : undefined, exhausted: cursor !== undefined };
}

/** A digest encodes intended request parameters; it never imports run or frontier allowance identity. */
function binding(parts: readonly string[]): string { return `sha256:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`; }

/** Only failure or a certified response can release the actual held page; hard cleanup is distinct. */
export type IPageRelease = 'definite-failure' | 'closed-response' | 'hard-cleanup';

/** Instrumentation is associated by actual context object identity, not a matching public run ID. */
export interface IControlledService {
  readonly helpers: IHelpers;
  readonly held: Promise<void>;
  readonly published: Promise<void>;
  readonly childQueued: Promise<void>;
  readonly adapter: ITraversalAdapter;
  readonly inFlight: number;
  readonly peak: number;
  readonly sends: number;
  attach(context: IRunContext, instance: string): void;
  release(reason: IPageRelease): void;
  /** Cancel fixture-owned barriers during hard cleanup without fabricating a held-page acknowledgment. */
  cancel(): void;
  admit(request: IAdmissionRequest): Promise<IAdmissionDecision>;
  observe(event: IRunEvent): void;
}

/**
 * The actual perform callback acknowledges a sent held request. The admission
 * barrier delays A's cold memo until that acknowledgment; it cannot create a
 * consumer request if coordination never dispatched one. No private manifest
 * is passed to the response adapter or to the library's completion rules.
 */
export function createControlledService(trace: ITrace, limit: number, supervision: ISupervision, childRate?: IOperationSharedRate): IControlledService {
  const held = gate<void>();
  const cleanup = gate<void>();
  const childQueued = gate<void>();
  const published = gate<void>();
  const release = gate<IPageRelease>();
  let context: IRunContext | undefined;
  let instance: string | undefined;
  let released = false;
  let inFlight = 0; let peak = 0; let sends = 0;

  /** Every author/transport hook must observe the same actual root context object. */
  const scoped = (): { readonly runId: string; readonly instance: string } => {
    const current = supervision.current();
    if (current !== context || instance === undefined) { throw new Error('A controlled hook entered another actual run context'); }
    return { runId: current.runId, instance };
  };
  /** Provider receipt occurs only inside the real operation engine's perform callback. */
  const sent = (name: string, key: string, send: IOperationSend): void => {
    sends += 1; inFlight += 1; peak = Math.max(peak, inFlight);
    trace.record('send', { name, key, operation: send.operation, requestAttempt: send.requestAttempt, inFlight }, scoped());
    if (sends > limit || inFlight > 2) { throw new Error('The ordinary fixture exceeded its send or concurrency bound'); }
  };
  /** Each actual deterministic response supplies one unique request-derived usage report. */
  const usage = (send: IOperationSend) => ({ report: `fixture:${send.requestAttempt}`, quantities: [{ unit: 'fixture-requests', amount: 1 }] });

  const helpers: IHelpers = {
    fetchPage(query, cursor): Promise<IPage> {
      if (query.person !== fixedQuery.person || query.repository !== fixedQuery.repository || query.window !== fixedQuery.window || (cursor !== undefined && cursor !== 'page-2')) { throw new Error('The source received an unexpected fixed query or cursor'); }
      return supervision.execution().operation<IPage>({
        name: 'search-page', binding: binding([query.person, query.repository, query.window, cursor ?? 'root']), retry: { maxAttempts: 1 },
        async perform(send) {
          try {
            sent('search-page', cursor ?? 'root', send);
            if (cursor === undefined) { return { kind: 'succeeded', value: response(undefined), usage: usage(send) }; }
            trace.record('page-held', { key: 'page-2', operation: send.operation, requestAttempt: send.requestAttempt }, scoped());
            held.resolve();
            let detach: () => void = () => undefined;
            const aborted = new Promise<IPageRelease>(resolve => { detach = send.signal.onAbort(() => resolve('hard-cleanup')); });
            let reason: IPageRelease;
            try { reason = await Promise.race([release.promise, aborted]); } finally { detach(); }
            if (reason === 'closed-response') { return { kind: 'succeeded', value: response(cursor), usage: usage(send) }; }
            if (reason === 'hard-cleanup') { return { kind: 'unknown' }; }
            return { kind: 'failed', transient: false, error: 'fixture-page-two-definite-refusal', retryFacts: { providerCode: 'fixture-page2-refused', conditions: ['definite', 'permanent'] }, usage: usage(send) };
          } finally { inFlight -= 1; }
        },
        cancel: () => Promise.resolve('cancelled'),
      });
    },
    current(name, id): Promise<ICurrent> {
      if (id === undefined) { throw new Error('Definition admitted a member without its required key'); }
      trace.record('source-check', { name, member: id }, scoped());
      if (name === 'discussion' && id === primaryMember) { childQueued.resolve(); }
      return supervision.execution().operation<ICurrent>({
        name, binding: binding([name, id, fixedQuery.window]), retry: { maxAttempts: 1 },
        ...(name === 'discussion' && childRate !== undefined ? { sharedRate: childRate } : {}),
        perform: send => {
          try { sent(name, id, send); return Promise.resolve({ kind: 'succeeded', value: { content: `${name}:${id}:content-v1`, revision: 'fixture-r1', unread: 'unread-v1' }, usage: usage(send) }); }
          finally { inFlight -= 1; }
        },
        cancel: () => Promise.resolve('cancelled'),
      });
    },
    assess(id, discussion, detail): Promise<IAssessment> {
      if (id === undefined) { throw new Error('An assessment has no stable qualified identity'); }
      return supervision.execution().operation<IAssessment>({
        name: 'assessment', binding: binding([id, discussion, detail]), retry: { maxAttempts: 1 },
        perform: send => {
          try { sent('assessment', id, send); return Promise.resolve({ kind: 'succeeded', value: { id, statement: `${discussion}|${detail}` }, usage: usage(send) }); }
          finally { inFlight -= 1; }
        },
        cancel: () => Promise.resolve('cancelled'),
      });
    },
    collected(frontier): void { trace.record('collection-body', { frontier }, scoped()); },
    summary(entries): ISummary {
      trace.record('strict-body', {}, scoped());
      return { ids: entries.flatMap(entry => entry.status === 'succeeded' ? [entry.data.id] : []) };
    },
    invalid(): never { throw new Error('The declared collection has no valid captured frontier evidence'); },
  };
  return {
    helpers, held: held.promise, published: published.promise, childQueued: childQueued.promise,
    get inFlight(): number { return inFlight; }, get peak(): number { return peak; }, get sends(): number { return sends; },
    attach(owned, token): void {
      if (context !== undefined) { throw new Error('This fixed fixture cannot enter a second run'); }
      context = owned; instance = token;
    },
    release(reason): void {
      if (context === undefined || instance === undefined || released) { throw new Error('A held-page release has no unique current owner'); }
      released = true;
      trace.record('page-release', { reason }, { runId: context.runId, instance });
      release.resolve(reason);
    },
    cancel(): void {
      cleanup.resolve();
      if (!released) { released = true; release.resolve('hard-cleanup'); }
    },
    async admit(request): Promise<IAdmissionDecision> {
      if (request.step.slot === 'assess' && request.step.memberKey === primaryMember) {
        const outcome = await Promise.race([held.promise.then(() => 'held' as const), cleanup.promise.then(() => 'cancelled' as const)]);
        if (outcome === 'cancelled') { return { kind: 'cancelled', reason: 'fixture hard cleanup' }; }
      }
      trace.record('policy-admitted', { slot: request.step.slot, member: request.step.memberKey ?? null }, scoped());
      return { kind: 'admitted' };
    },
    observe(event): void {
      // Stop intent may be requested outside any async run frame. The actual
      // installed observer belongs to this context; other author/transport
      // hooks still require object-identical currentRun() through scoped().
      if (context === undefined || instance === undefined || event.runId !== context.runId) { throw new Error('A run observer received a foreign context'); }
      const associated = event.kind === 'stop' ? { runId: context.runId, instance } : scoped();
      if (event.kind === 'step') {
        const { step, phase, reference } = event.event;
        trace.record('lifecycle', { step, phase, reference: reference ?? null }, associated);
        if (phase === 'execute' && step.slot === 'assess') { trace.record('assessment-body', { member: step.memberKey ?? null }, associated); }
        if (step.slot === 'summary') {
          if (phase === 'admit') { trace.record('strict-admission', {}, associated); }
          if (phase === 'publish') { trace.record('strict-publication', { reference: reference?.locator ?? null }, associated); }
        }
        if (phase === 'publish' && reference !== undefined) {
          trace.record('publication', { slot: step.slot, member: step.memberKey ?? null, reference: reference.locator }, associated);
          if (step.slot === 'assess' && step.memberKey === primaryMember) { published.resolve(); }
        }
      } else if (event.kind === 'operation') { trace.record('operation', { ...event }, associated); }
      else if (event.kind === 'stop') { trace.record('stop', { ...event }, associated); }
      else if (event.kind === 'wait') { trace.record('wait', { ...event }, associated); }
    },
    adapter: { accept(page, previous) {
      const adapted = adaptPage(page, previous);
      trace.record('adapter-frontier', { kind: adapted.kind, frontier: adapted.frontier }, scoped());
      return adapted;
    } },
  };
}

/** One fresh composition is built per actual process, without opening storage or starting analysis. */
export function composeFixture(helpers: IHelpers): {
  readonly authoring: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  readonly witness: IRootAcquisitionWitness<IInputs, IHelpers>;
} {
  const builders = authoring<IInputs, IHelpers>();
  const page = builders.sourceSlot<readonly [typeof fixedQuery, string | undefined], IPage>({ slot: 'page' });
  const implementation = builders.suppliedSource<readonly [typeof fixedQuery, string | undefined], IPage>({
    finality: () => false,
    run: async context => context.outcome.fresh<IPage>(await context.helpers.fetchPage(context.args[0], context.args[1])),
  });
  const frontier = builders.source<IFrontier>({
    subject: 'frontier:fixture-person-1', collection: { identity: 'id' }, finality: () => false,
    run: context => {
      if (context.evidence === undefined) { return context.helpers.invalid(); }
      const members: IPr[] = [];
      for (let index = 0; index < context.evidence.members.length; index += 1) {
        const entry = context.evidence.members[index];
        if (entry === undefined) { return context.helpers.invalid(); }
        members.push({ ...(entry.id === undefined ? {} : { id: entry.id }), identity: entry.identity, number: entry.number });
      }
      const captured = { members, status: context.evidence.status, revision: context.evidence.revision };
      context.helpers.collected(captured);
      return context.outcome.fresh<IFrontier>(captured);
    },
  });
  const prs = builders.template({ slot: 'prs', collection: frontier, steps: member => {
    const discussion = member.source<ICurrent>({ subject: member.subject('discussion'), finality: () => false, run: async context => {
      const latest = await context.helpers.current('discussion', context.member.id);
      const previous = context.previous;
      return previous !== undefined && previous.data.content === latest.content && previous.data.revision === latest.revision && previous.data.unread === latest.unread ? context.outcome.retain(previous) : context.outcome.fresh<ICurrent>(latest);
    } });
    const detail = member.source<ICurrent>({ subject: member.subject('detail'), finality: () => false, run: async context => {
      const latest = await context.helpers.current('detail', context.member.id);
      const previous = context.previous;
      return previous !== undefined && previous.data.content === latest.content && previous.data.revision === latest.revision && previous.data.unread === latest.unread ? context.outcome.retain(previous) : context.outcome.fresh<ICurrent>(latest);
    } });
    return { discussion, detail, assess: member.memo({ subject: member.subject('assessment'), children: { discussion, detail }, run: async context => {
      const discussionResult = await context.calls.discussion();
      const detailResult = await context.calls.detail();
      return context.helpers.assess(context.member.id, discussionResult.data.content, detailResult.data.content);
    } }) };
  } });
  const summary = builders.fold({ subject: 'summary:fixture-person-1', over: { template: prs, step: 'assess' }, run: context => context.helpers.summary(context.members) });
  const relationship = builders.traversal({ slot: 'person-prs', query: 'query', page, collection: frontier, template: prs, fold: summary });
  const composition = builders.compose({
    scope: analysis, inputs: [{ slot: 'query', value: fixedQuery }],
    helpers: [{ slot: 'fetchPage', helper: helpers.fetchPage }, { slot: 'current', helper: helpers.current }, { slot: 'assess', helper: helpers.assess }, { slot: 'collected', helper: helpers.collected }, { slot: 'summary', helper: helpers.summary }, { slot: 'invalid', helper: helpers.invalid }],
    supplied: [builders.supplySource({ slot: page, declaration: implementation, subject: ([query, cursor]) => {
      if (query === undefined) { throw new Error('A root query has not been supplied'); }
      return `page:${query.person}:${query.repository}:${query.window}:${cursor ?? 'root'}`;
    } })],
    steps: [{ slot: 'frontier', declaration: frontier }, { slot: 'summary', declaration: summary }], templates: [prs], traversals: [relationship],
  });
  return { authoring: builders, composition, witness: builders.rootAcquisition(composition, relationship) };
}
