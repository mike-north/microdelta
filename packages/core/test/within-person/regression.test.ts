/** Repeatable real-owner page handoff and stop-boundary regressions, not campaign qualification. */
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDurableAccounting } from '@microdelta/accounting';
import { openDurableHistory } from '@microdelta/history';
import { createNodeMachine, createNodeRandom, createNodeSqlite } from '@microdelta/machine-node';
import { createResolution } from '@microdelta/resolution';
import type { IFoldRequest, IFoldResolution, IResolution } from '@microdelta/resolution';
import { createSharedRateCoordinator, createStopController, createSupervision, operationJournalDeclaration } from '@microdelta/supervision';
import { createTrackingObserver } from '@microdelta/tracking';
import { afterAll, expect, test } from '@jest/globals';

import { writerFor } from '../../src/writer.js';
import { fakeTimer, T0, until } from '../operations/harness.js';
import type { ITraversalReport } from '../../src/index.js';
import { analysis, composeFixture, createControlledService, environment, logicalStore, primaryMember } from './fixture.js';
import { beforeRunTerminates, createFailureLatch, finalizeCase, formatFailureDiagnostic, requireResourceBounds, writeCaseOutput } from './guard.js';
import type { IResourceSample } from './guard.js';
import { createTrace } from './trace.js';
import type { ITrace, ITraceEvent } from './trace.js';

/** Every phase shares one absolute deadline; expiration is not task termination. */
async function within<T>(value: Promise<T>, deadline: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const remaining = Math.max(0, deadline - Date.now());
    return await Promise.race([value, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Missing ${label} acknowledgment`)), remaining); })]);
  } finally { if (timer !== undefined) { clearTimeout(timer); } }
}


/** A Resolution pass is the real request, capture token and returned owner result. */
interface IRecordedPass {
  readonly request: IFoldRequest;
  readonly result: IFoldResolution;
  readonly returnedSnapshot: string;
  readonly requestSequence: number;
}

/** Only actual observed acknowledgments establish order; time passing does not. */
function events(trace: ITrace, kind: string): readonly ITraceEvent[] { return trace.events.filter(event => event.kind === kind); }
/** No strict fold is admitted or published against an open frontier. */
function expectNoStrict(trace: ITrace): void {
  expect(events(trace, 'strict-admission')).toHaveLength(0);
  expect(events(trace, 'strict-body')).toHaveLength(0);
  expect(events(trace, 'strict-publication')).toHaveLength(0);
}
/** This bounded fixture uses fresh regular files only, never campaign data. */
function storeBytes(directory: string): number {
  return readdirSync(directory).reduce((size, name) => size + statSync(join(directory, name)).size, 0);
}

let elapsedTotal = 0;
let completedRuns = 0;
let completedTraversals = 0;
let totalSends = 0;
/** Uncertain run, owner, store or output finalization forbids another real case. */
let unresolvedCase = false;

/** One test owns exactly one workspace run and one declared traversal. */
async function scenario(mode: 'cold' | 'soft' | 'hard', limit: number): Promise<void> {
  if (unresolvedCase) { throw new Error('A previous owned run has not closed'); }
  const started = Date.now();
  const liveDeadline = started + 12_000;
  const cleanupDeadline = started + 16_000;
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-within-person-ordinary-'));
  const trace = createTrace();
  const timer = fakeTimer();
  const machine = createNodeMachine();
  const elapsedClock = { currentElapsedMilliseconds: () => timer.currentEpochMilliseconds() - T0 };
  const coordinator = createSharedRateCoordinator({ epochClock: timer, elapsedClock });
  const surface = coordinator.registerSurface({ environment, service: 'fixture', accessContext: `ordinary:${mode}`, surface: 'discussion', gates: [{ id: 'api' }] });
  const floor = T0 + 1_000;
  if (mode !== 'cold') { coordinator.observeCooldown(surface, 'api', floor); }
  const supervision = createSupervision({ context: machine, timer, sharedRates: { coordinator, elapsedClock } });
  const service = createControlledService(trace, limit, supervision, mode === 'cold' ? undefined : { surface, cooldownGateId: 'api' });
  const graph = composeFixture(service.helpers);
  const passes: IRecordedPass[] = [];
  const stop = createStopController({ timer });
  const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: timer, sha256: machine, location: join(directory, 'history.sqlite'), logicalStore });
  const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'accounting.sqlite'), logicalStore });
  let runCount = 0;
  let traversalCount = 0;
  let settled = false;
  let running: Promise<unknown> | undefined;
  let sampledStorePeak = 0;
  let sampledRssPeak = 0;
  const resourceFailure = createFailureLatch();
  let initialSample: IResourceSample | undefined;
  let samples = 0;
  let failure: { readonly cause: unknown } | undefined;
  /** Boundary and interval samples are finite evidence, not continuous resource measurement. */
  const sample = (): void => {
    try {
      const observed = { rssBytes: process.memoryUsage().rss, storeBytes: storeBytes(directory) };
      initialSample ??= observed; samples += 1;
      sampledStorePeak = Math.max(sampledStorePeak, observed.storeBytes);
      sampledRssPeak = Math.max(sampledRssPeak, observed.rssBytes);
      requireResourceBounds(observed);
    } catch (error: unknown) { resourceFailure.fail(error); stop.request({ level: 'hard' }); }
  };
  const sampler = setInterval(sample, 100);
  try {
    // Refuse before an owner start when the actual shared process already exceeds this case's ceiling.
    sample(); resourceFailure.check();
    const actualRunning = supervision.run({ analysis, environment, runId: `ordinary:${mode}`, stop, permits: 2, window: 2, deferral: 'sleep',
      writer: writerFor(history, `ordinary:${mode}`, 30_000),
      operations: { journal: history.openJournal(operationJournalDeclaration), accounting, random: createNodeRandom() },
      admission: { admit: request => service.admit(request) }, observers: [{ observe: event => service.observe(event) }],
      resolution: ports => {
        const real = createResolution({ declarations: graph.authoring, composition: graph.composition,
          bindings: { inputs: graph.composition.topology.inputs, helpers: graph.composition.topology.helpers }, environment, history,
          tracking: createTrackingObserver(machine), host: machine, admission: ports.admission, observer: ports.observer,
          execution: ports.execution, traversalAuthority: ports.traversalAuthority });
        // Observe exactly the normal request and result that Resolution owns; never replace or synthesize either.
        const observed: IResolution = { ...real, async resolveFold(request) {
          const entry = trace.record('fold-request', { normalRequestKey: request.normalRequestKey ?? null });
          const result = await real.resolveFold(request);
          passes.push({ request, result, returnedSnapshot: JSON.stringify(result), requestSequence: entry.sequence });
          return result;
        } };
        return observed;
      },
    }, async run => {
      runCount += 1;
      service.attach(run.context, 'ordinary');
      traversalCount += 1;
      const report = await run.traverse(graph.witness, service.adapter, { requestKey: `ordinary:${mode}` });
      const operations = await run.inspectOperations();
      return { report, operations };
    });
    running = actualRunning;
    const result = actualRunning.then(value => { settled = true; return value; }, (error: unknown) => { settled = true; throw error; });
    void result.catch(() => undefined);
    /** A sampled refusal keeps its original identity at every live acknowledgment. */
    const wait = <T>(value: Promise<T>, label: string): Promise<T> => within(Promise.race([value, resourceFailure.promise]), liveDeadline, label);
    /** A settled owner cannot subsequently supply an acknowledgment it never emitted. */
    const acknowledge = <T>(value: Promise<T>, label: string): Promise<T> => wait(beforeRunTerminates(value, result, label), label);
    await acknowledge(service.held, 'actual page-two send');
    expect(events(trace, 'page-held')).toHaveLength(1);
    expect(events(trace, 'page-release')).toHaveLength(0);
    expectNoStrict(trace);
    if (mode === 'cold') {
      await acknowledge(service.published, 'A publication while page two held');
      await acknowledge(until(() => passes.some(pass => pass.result.discovery.kind === 'keyed'
        && pass.result.discovery.completion === 'open' && pass.result.outcome.kind === 'waiting'
        && pass.result.members.some(member => member.key === primaryMember && member.outcome.kind === 'published')),
      'F1 normal request returns its open waiting result'), 'F1 result');
      const first = passes.find(pass => pass.result.discovery.kind === 'keyed' && pass.result.discovery.completion === 'open'
        && pass.result.outcome.kind === 'waiting' && pass.result.members.some(member => member.key === primaryMember && member.outcome.kind === 'published'));
      if (first === undefined || first.request.sourceEvidence === undefined || first.request.normalRequestKey === undefined) { throw new Error('F1 has no actual captured request'); }
      expect(first.result.discovery).toMatchObject({ kind: 'keyed', completion: 'open', keys: [primaryMember] });
      expect(first.result.members).toHaveLength(1);
      const firstMember = first.result.members[0];
      if (firstMember === undefined || firstMember.outcome.kind !== 'published') { throw new Error('F1 did not publish A'); }
      const aReference = firstMember.outcome.reference;
      const publication = events(trace, 'publication').find(event => event.facts['slot'] === 'assess' && event.facts['member'] === primaryMember);
      expect(publication?.facts['reference']).toBe(aReference.locator);
      expectNoStrict(trace);
      service.release('closed-response');
      const terminal = await wait(result, 'closed traversal and drain');
      expect(terminal.value.report).toMatchObject({ kind: 'complete', report: { outcome: { status: 'succeeded' } } });
      expect(JSON.stringify(first.result)).toBe(first.returnedSnapshot);
      const final = passes.find(pass => pass.result.discovery.kind === 'keyed' && pass.result.discovery.completion === 'complete'
        && pass.result.outcome.kind === 'published');
      if (final === undefined || final.request.sourceEvidence === undefined || final.request.normalRequestKey === undefined) { throw new Error('F2 has no actual closed request'); }
      expect(final.request.normalRequestKey).not.toBe(first.request.normalRequestKey);
      expect(final.request.sourceEvidence).not.toBe(first.request.sourceEvidence);
      for (const pass of passes.filter(pass => pass.request.normalRequestKey === first.request.normalRequestKey)) {
        expect(pass.request.sourceEvidence).toBe(first.request.sourceEvidence);
      }
      expect(final.result.discovery).toMatchObject({ kind: 'keyed', completion: 'complete', keys: [primaryMember, 'fixture/repo#102'] });
      expect(final.result.members.map(member => member.key)).toEqual([primaryMember, 'fixture/repo#102']);
      const finalA = final.result.members.find(member => member.key === primaryMember);
      const finalB = final.result.members.find(member => member.key === 'fixture/repo#102');
      expect(finalA?.outcome).toMatchObject({ kind: 'reused', reference: aReference });
      expect(finalB?.outcome.kind).toBe('published');
      expect(events(trace, 'assessment-body').filter(event => event.facts['member'] === primaryMember)).toHaveLength(1);
      expect(events(trace, 'send').filter(event => event.facts['name'] === 'assessment' && event.facts['key'] === primaryMember)).toHaveLength(1);
      expect(final.result.outcome).toMatchObject({ kind: 'published', coverage: { closed: true, required: [primaryMember, 'fixture/repo#102'], skipped: [] } });
      if (final.result.outcome.kind !== 'published') { throw new Error('Strict result was not published'); }
      expect(history.reader.readSubtree(final.result.outcome.reference, [])).toEqual({ ids: [primaryMember, 'fixture/repo#102'] });
      const finalReport = terminal.value.report;
      if (finalReport.kind !== 'complete') { throw new Error('Traversal did not complete'); }
      expect(finalReport.report.discovery).toEqual(final.result.discovery);
      expect(finalReport.report.members.map(member => member.key)).toEqual([primaryMember, 'fixture/repo#102']);
      expect(finalReport.report.members[0]).toMatchObject({ status: 'succeeded', outcome: { kind: 'reused', reference: aReference } });
      expect(finalReport.report.members[1]).toMatchObject({ status: 'succeeded', outcome: { kind: 'published' } });
      if (final.result.discovery.kind !== 'keyed') { throw new Error('Closed request did not produce keyed evidence'); }
      const closedReference = final.result.discovery.reference.locator;
      const acceptedCollection = events(trace, 'lifecycle').find(event => {
        const reference = event.facts['reference'];
        const phase = event.facts['phase'];
        if ((phase !== 'publish' && phase !== 'accept') || typeof reference !== 'object' || reference === null) { return false; }
        const locator: unknown = Reflect.get(reference, 'locator');
        return locator === closedReference;
      });
      const strictAdmission = events(trace, 'strict-admission');
      const strictBody = events(trace, 'strict-body');
      const strictPublication = events(trace, 'strict-publication');
      expect(acceptedCollection).toBeDefined();
      expect(strictAdmission).toHaveLength(1); expect(strictBody).toHaveLength(1); expect(strictPublication).toHaveLength(1);
      if (acceptedCollection === undefined || strictAdmission[0] === undefined || strictBody[0] === undefined || strictPublication[0] === undefined) {
        throw new Error('Closed collection or strict lifecycle evidence is absent');
      }
      expect(strictAdmission[0].sequence).toBeGreaterThan(acceptedCollection.sequence);
      expect(strictBody[0].sequence).toBeGreaterThan(acceptedCollection.sequence);
      expect(strictPublication[0].sequence).toBeGreaterThan(acceptedCollection.sequence);
      expect(strictPublication[0].facts['reference']).toBe(final.result.outcome.reference.locator);
    } else {
      await acknowledge(service.childQueued, 'declared child operation issued');
      expect(events(trace, 'assessment-body').some(event => event.facts['member'] === primaryMember)).toBe(true);
      expect(events(trace, 'collection-body')[0]?.facts['frontier']).toMatchObject({ status: 'open', members: [{ id: primaryMember }] });
      await acknowledge(until(() => timer.pending().includes(floor), 'declared child rate floor is armed'), 'rate wait');
      expect(events(trace, 'send').filter(event => event.facts['name'] === 'discussion')).toHaveLength(0);
      expectNoStrict(trace);
      service.release('definite-failure');
      await acknowledge(until(() => stop.state.level === 'soft', 'producer failure requests soft stop'), 'soft stop');
      expect(events(trace, 'send').filter(event => event.facts['name'] === 'discussion')).toHaveLength(0);
      if (mode === 'hard') { stop.request({ level: 'hard' }); }
      timer.advanceTo(floor);
      const terminal = await wait(result, 'failed traversal and owned drain');
      const report: ITraversalReport = terminal.value.report;
      expect(report.kind).toBe('discovery-failed');
      if (report.kind === 'discovery-failed') { expect(report.error).toBeDefined(); }
      expectNoStrict(trace);
      const discussionSends = events(trace, 'send').filter(event => event.facts['name'] === 'discussion');
      if (mode === 'soft') {
        expect(discussionSends).toHaveLength(1);
        const stopEvent = events(trace, 'stop').find(event => event.facts['level'] === 'soft');
        expect(stopEvent).toBeDefined();
        if (stopEvent !== undefined && discussionSends[0] !== undefined) { expect(discussionSends[0].sequence).toBeGreaterThan(stopEvent.sequence); }
        expect(events(trace, 'publication').some(event => event.facts['slot'] === 'assess' && event.facts['member'] === primaryMember)).toBe(true);
      } else {
        expect(discussionSends).toHaveLength(0);
        expect(events(trace, 'publication').some(event => event.facts['slot'] === 'assess')).toBe(false);
      }
    }
    expect(runCount).toBe(1);
    expect(traversalCount).toBe(1);
    expect(service.sends).toBeLessThanOrEqual(limit);
    expect(Buffer.byteLength(JSON.stringify(trace.events))).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(service.inFlight).toBe(0);
    expect(service.peak).toBeLessThanOrEqual(2);
    sample();
    resourceFailure.check();
    expect(sampledStorePeak).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(sampledRssPeak).toBeLessThanOrEqual(512 * 1024 * 1024);
  } catch (cause: unknown) {
    failure = { cause };
    throw cause;
  } finally {
    clearInterval(sampler);
    if (!settled) { stop.request({ level: 'hard' }); }
    service.cancel();
    if (running !== undefined && !settled) {
      try { await within(running.then(() => undefined, () => undefined), cleanupDeadline, 'owned run closure'); }
      catch (cause: unknown) { unresolvedCase = true; failure ??= { cause }; }
    }
    let recordedElapsed = 0;
    const finalized = await finalizeCase({ primary: failure, drained: !unresolvedCase,
      owners: [{ name: 'accounting', close: () => { accounting.close(); } }, { name: 'history', close: () => { history.close(); } }],
      removeStore: () => { rmSync(directory, { recursive: true, force: true }); },
      record(state): void {
        unresolvedCase ||= !state.ownersClosed || !state.storeRemoved;
        recordedElapsed = Date.now() - started;
        elapsedTotal += recordedElapsed; completedRuns += runCount; completedTraversals += traversalCount; totalSends += service.sends;
        expect(unresolvedCase).toBe(false); expect(recordedElapsed).toBeLessThanOrEqual(16_000);
      },
      async metrics(state): Promise<void> {
        // This is an observation before the diagnostic attempt, not a claim that the output sink or case will succeed.
        await writeCaseOutput(`${JSON.stringify({ kind: 'ordinary-regression-case', mode, outcome: state.failure === undefined ? 'no-failure-observed' : 'failed',
          initial: initialSample ?? null, peak: { rssBytes: sampledRssPeak, storeBytes: sampledStorePeak }, samples, elapsedMilliseconds: Date.now() - started,
          runs: runCount, traversals: traversalCount, sends: service.sends, inFlight: service.inFlight, peakSends: service.peak,
          stop: stop.state.level, unresolved: unresolvedCase, ownersClosed: state.ownersClosed, storeRemoved: state.storeRemoved,
          metricsAttempted: state.metricsAttempted, diagnosticAttempted: state.diagnosticAttempted })}\n`, cleanupDeadline);
      },
      async diagnostic(state): Promise<void> {
        await writeCaseOutput(`${formatFailureDiagnostic({ mode, failure: state.failure?.cause, initial: initialSample ?? null,
          peak: { rssBytes: sampledRssPeak, storeBytes: sampledStorePeak }, samples, elapsedMilliseconds: Date.now() - started,
          runs: runCount, traversals: traversalCount, sends: service.sends, inFlight: service.inFlight, peakSends: service.peak,
          stop: stop.state, unresolved: unresolvedCase || !state.mayStartNext, finalization: state, trace: trace.events })}\n`, cleanupDeadline);
      },
    });
    unresolvedCase ||= !finalized.mayStartNext;
    const finalElapsed = Date.now() - started;
    elapsedTotal += finalElapsed - recordedElapsed;
    let finalFailure = finalized.failure;
    try { expect(finalElapsed).toBeLessThanOrEqual(16_000); }
    catch (cause: unknown) { finalFailure ??= { cause }; }
    if (finalFailure !== undefined) { throw finalFailure.cause; }
  }
}

// These three independent cases are the whole ordinary invocation: 3 runs, 3 traversals and at most 10+6+5 sends.
test('held cold frontier publishes A before certified closure and only then allows strict summary', async () => { await scenario('cold', 10); }, 18_000);
test('producer failure soft-drains the admitted parent and declared child first attempt', async () => { await scenario('soft', 6); }, 18_000);
test('hard stop refuses the matching queued declared-child send', async () => { await scenario('hard', 5); }, 18_000);

afterAll(() => {
  expect(completedRuns).toBe(3); expect(completedTraversals).toBe(3);
  expect(totalSends).toBeLessThanOrEqual(21); expect(elapsedTotal).toBeLessThanOrEqual(60_000);
});
