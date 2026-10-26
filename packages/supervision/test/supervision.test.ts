/**
 * Owner tests for Run Supervision: scoped run lifetime and context lookup,
 * lazy writer ownership, admission and observer positions, and ordinary
 * nonmemoized work. The asynchronous scope is Node's real AsyncLocalStorage
 * supplied through the structural capability; Resolution is a recording port
 * double, because this owner suite proves Supervision's contract, not reuse.
 * The same behaviors run over the real owner implementations in the facade's
 * assembly suites (`packages/core/test/workspace`).
 *
 * @see ../../../docs/spec/operations.md (RUN-001)
 * @see ../../../docs/spec/domain.md (DOM-2, DOM-4)
 * @see ../../../docs/spec/execution.md (REUSE-009)
 * @see ../../../docs/spec/acceptance.md (A-18, A-19)
 * @see ../../../docs/plans/m3-contribution-analysis.md (Supervision and actual consumer path)
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from '@jest/globals';
import { declarations } from '@microdelta/definition';
import { createNodeClock, createNodeElapsedClock, createNodeRandom, createNodeSqlite, createNodeSqliteReader, createNodeTimer } from '@microdelta/machine-node';
import type { IBindingDescriptor, IBindingFamily } from '@microdelta/definition';
import { ResolutionError } from '@microdelta/resolution';
import type {
  IAdmissionDecision,
  IAdmissionRequest,
  ICheckOutcome,
  IDiscoveryOutcome,
  IFoldOutcome,
  IFoldRequest,
  IFoldResolution,
  IGateEvidence,
  ILifecycleEvent,
  IMemberResolution,
  IMembersRequest,
  IMembersResolution,
  IOutcomeFoldCoverage,
  IOutcomeFoldOutcome,
  IOutcomeFoldResolution,
  IRecoveryResult,
  IResolution,
  IResolutionOutcome,
  IResolveRequest,
} from '@microdelta/resolution';

import { SupervisionError, createStopController, createSupervision, openExecutionObservationReader, ordinaryLifecycle, stepLifecycle } from '../src/index.js';
import { _incrementObservationEventCounts, _incrementObservationFaults } from '../src/observation.js';
import type {
  IFoldReport,
  IMemberOutcome,
  IOutcomeFoldReport,
  IResolutionPorts,
  IRun,
  IRunEvent,
  IRunLease,
  IRunObserver,
  IRunOptions,
  IRunScope,
  IRunScopeCapability,
  ISupervision,
  IExecutionObservationEventCounts,
  IWriterAttempt,
} from '../src/index.js';

/** Use a separate Node process to prove a locator survives observer restart. */
function readInFreshProcess(locator: { readonly location: string; readonly executionId: string }): unknown {
  const source = `import { createNodeSqliteReader } from '@microdelta/machine-node';
import { openExecutionObservationReader } from ${JSON.stringify(new URL('../src/index.js', import.meta.url).href)};
const reader = openExecutionObservationReader(createNodeSqliteReader(), JSON.parse(process.argv[1]));
process.stdout.write(JSON.stringify(reader.read()));
reader.close();`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source, JSON.stringify(locator)], { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000 });
  expect(child.status).toBe(0);
  expect(child.stderr).toBe('');
  return JSON.parse(child.stdout) as unknown;
}

/** Node's real asynchronous context, supplied structurally as a host would. */
const nodeScopes: IRunScopeCapability = {
  createAsyncContext<T>(): IRunScope<T> {
    return new AsyncLocalStorage<T>();
  },
};

/** The step the recording Resolution double is asked about. */
const step: IBindingDescriptor = Object.freeze({ scope: 'analysis:test', role: 'step', slot: 'summary', memberKey: 'person:ada' });

/** An exact reference as History would mint it. */
const reference = Object.freeze({ kind: 'completed-result' as const, locator: 'mdh1:test:1' });

/** Assert a rejection carries the expected Supervision code. */
async function expectSupervisionError(action: Promise<unknown> | (() => unknown), code: SupervisionError['code']): Promise<void> {
  let caught: unknown;
  try {
    await (typeof action === 'function' ? action() : action);
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SupervisionError);
  expect(caught instanceof SupervisionError ? caught.code : undefined).toBe(code);
}

/**
 * Settle an escaped lookup into a value immediately, so a failing assertion
 * earlier in a test is reported instead of surfacing as an unhandled rejection.
 */
function settled(promise: Promise<unknown>): Promise<{ readonly value?: unknown; readonly error?: unknown }> {
  return promise.then((value: unknown) => ({ value }), (error: unknown) => ({ error }));
}

/** The Supervision code of a settled failure, if it is one. */
function settledCode(result: { readonly error?: unknown }): string | undefined {
  return result.error instanceof SupervisionError ? result.error.code : undefined;
}

/**
 * How the double settles one scripted member of a members request, as real
 * Resolution would: a gate that skips or fails it, or a required instance
 * whose work is presented to Supervision's admission port and then published
 * (or fails while executing).
 */
type IMemberScript =
  | { readonly key: string; readonly gate: 'skipped' }
  | { readonly key: string; readonly gate: 'failed' }
  | { readonly key: string; readonly gate: 'required'; readonly body: 'publishes' | 'fails' };

/** What the double's discovery does before any member: key the scripted members, reject them, or present discovery work to admission. */
type IDiscoveryScript = 'keyed' | 'rejected' | 'admission';

/** What the recording Resolution double did, and hooks a test can set. */
interface IDouble {
  /** The ports Supervision supplied, once the factory ran. */
  ports: IResolutionPorts | undefined;
  /** Every request, in order. */
  readonly calls: { readonly operation: 'resolve' | 'check' | 'recover' | 'members' | 'fold' | 'outcome-fold'; readonly lease?: IRunLease; readonly requestKey?: string; readonly template?: string; readonly step?: string }[];
  /** The scripted members a members request settles, in the order discovery lists them. */
  members: readonly IMemberScript[];
  /** How the members request's discovery settles. */
  discovery: IDiscoveryScript;
  /** Admission decisions returned to the double. */
  readonly decisions: IAdmissionDecision[];
  /** Runs where Resolution's author code would run, inside the request. */
  during: (() => void) | undefined;
  /** Diagnostics the double's normal outcome reports. */
  diagnostics: readonly string[];
  /** The fold outcome a fold request reports once its members settled. */
  fold: IFoldOutcome;
  /** The outcome fold outcome an outcome fold request reports once its members settled. */
  outcomeFold: IOutcomeFoldOutcome;
}

/** The fold step the double resolves, and the template step it consumes. */
const foldStep: IBindingDescriptor = Object.freeze({ scope: 'analysis:test', role: 'step', slot: 'report' });
const foldOver: IBindingDescriptor = Object.freeze({ scope: 'analysis:test', role: 'step', slot: 'summary', template: 'contributor', collection: 'contributors' });

/** Evidence fields of a fold outcome that ran no fold work. */
const noFoldWork = Object.freeze({ step: foldStep, misses: [], trace: [], diagnostics: [] });

/** Outcome fold coverage with every status list empty. */
const emptyCoverage: Omit<IOutcomeFoldCoverage, 'openDiscovery' | 'complete'> = Object.freeze({ succeeded: [], skipped: [], failed: [], cancelled: [], pending: [] });

/** A Resolution double that follows the port contract: verify, admit, execute, publish. */
function recordingResolution(): { readonly double: IDouble; readonly factory: IRunOptions['resolution'] } {
  const double: IDouble = {
    ports: undefined,
    calls: [],
    members: [],
    discovery: 'keyed',
    decisions: [],
    during: undefined,
    diagnostics: [],
    fold: Object.freeze({ ...noFoldWork, kind: 'waiting', pending: [], openDiscovery: true }),
    outcomeFold: Object.freeze({ ...noFoldWork, kind: 'waiting', coverage: Object.freeze({ ...emptyCoverage, openDiscovery: true, complete: false as const }) }),
  };
  const factory = (ports: IResolutionPorts): IResolution => {
    double.ports = ports;
    const emit = (phase: ILifecycleEvent['phase']): void => {
      ports.observer.observe(Object.freeze({ step, phase, ...(phase === 'publish' ? { reference } : {}) }));
    };
    /** Settle the scripted members of one template step, as a members request (or a fold's member phase) does. */
    const settleMembers = async (template: string, stepSlot: string): Promise<IMembersResolution> => {
      const collection: IBindingDescriptor = Object.freeze({ scope: 'analysis:test', role: 'step', slot: 'contributors' });
      const collectionReference = Object.freeze({ kind: 'completed-result' as const, locator: 'mdh1:test:collection' });
      await Promise.resolve();
      double.during?.();
      if (double.discovery === 'admission') {
        const decision = await ports.admission.admit(Object.freeze({ step: collection, kind: 'source', subject: { analysis: 'analysis:test', environment: 'env:test', subject: 'contributors', version: 1 }, reason: 'source-policy' }));
        double.decisions.push(decision);
        if (decision.kind !== 'admitted') {
          return Object.freeze({ template, discovery: Object.freeze({ kind: 'refused', collection, refused: collection, reason: decision.reason, disposition: decision.kind }), members: [], diagnostics: [] });
        }
      }
      if (double.discovery === 'rejected') {
        const rejected: IDiscoveryOutcome = Object.freeze({
          kind: 'rejected',
          collection,
          reference: collectionReference,
          diagnostic: Object.freeze({ reason: 'duplicate-key', template, collection: 'contributors', key: 'person:ada', identity: 'key', customKey: false, message: 'Collection contributors has duplicate member key "person:ada".' }),
        });
        return Object.freeze({ template, discovery: rejected, members: [], diagnostics: [] });
      }
      const keys = double.members.map((member) => member.key).sort();
      const discovery: IDiscoveryOutcome = Object.freeze({ kind: 'keyed', collection, reference: collectionReference, completion: 'open', keys });
      const members: IMemberResolution[] = [];
      for (const key of keys) {
        const script = double.members.find((member) => member.key === key);
        const instance: IBindingDescriptor = Object.freeze({ scope: 'analysis:test', role: 'step', slot: stepSlot, template, collection: 'contributors', memberKey: key });
        const evidence = { misses: [], trace: [], diagnostics: [] };
        if (script === undefined || script.gate === 'failed') {
          members.push(Object.freeze({ key, step: instance, gate: undefined, outcome: Object.freeze({ kind: 'failed', error: new ResolutionError('gate-failure', `gate for ${key} returned a number`) }) }));
          continue;
        }
        const gate: IGateEvidence = Object.freeze({ selected: script.gate, observations: [] });
        if (script.gate === 'skipped') {
          members.push(Object.freeze({ key, step: instance, gate, outcome: Object.freeze({ ...evidence, step: instance, kind: 'skipped', gate }) }));
          continue;
        }
        const decision = await ports.admission.admit(Object.freeze({ step: instance, kind: 'memo', subject: { analysis: 'analysis:test', environment: 'env:test', subject: `summary:${key}`, version: 1 }, reason: 'cold' }));
        double.decisions.push(decision);
        if (decision.kind !== 'admitted') {
          members.push(Object.freeze({ key, step: instance, gate, outcome: Object.freeze({ ...evidence, step: instance, kind: 'refused', refused: instance, reason: decision.reason, disposition: decision.kind }) }));
          continue;
        }
        members.push(Object.freeze({
          key,
          step: instance,
          gate,
          outcome: script.body === 'publishes'
            ? Object.freeze({ ...evidence, step: instance, kind: 'published', reference: Object.freeze({ kind: 'completed-result' as const, locator: `mdh1:test:${key}` }), attemptId: 1 })
            : Object.freeze({ kind: 'failed', error: new ResolutionError('execution-failure', `Body of ${key} failed`) }),
        }));
      }
      return Object.freeze({ template, discovery, members, diagnostics: [...double.diagnostics] });
    };
    return {
      async resolve(request: IResolveRequest): Promise<IResolutionOutcome> {
        double.calls.push({ operation: 'resolve', lease: request.lease, requestKey: request.requestKey });
        emit('verify');
        emit('admit');
        const admission: IAdmissionRequest = Object.freeze({ step, kind: 'memo', subject: { analysis: 'analysis:test', environment: 'env:test', subject: 'summary:ada', version: 1 }, reason: 'cold' });
        const decision = await ports.admission.admit(admission);
        double.decisions.push(decision);
        if (decision.kind !== 'admitted') {
          emit('refuse');
          return Object.freeze({ kind: 'refused', step, refused: step, reason: decision.reason, disposition: decision.kind, misses: [], trace: [], diagnostics: [] });
        }
        emit('claim');
        emit('execute');
        await Promise.resolve();
        double.during?.();
        const diagnostics: string[] = [...double.diagnostics];
        try {
          emit('publish');
        } catch {
          // As Resolution does: the diagnostic names the position, never the observer's error text (RUN-013).
          diagnostics.push('observer failed at publish');
        }
        return Object.freeze({ kind: 'published', step, reference, attemptId: 1, misses: [], trace: [], diagnostics });
      },
      async resolveMembers(request: IMembersRequest): Promise<IMembersResolution> {
        double.calls.push({ operation: 'members', lease: request.lease, requestKey: request.requestKey, template: request.template, step: request.step });
        return settleMembers(request.template, request.step);
      },
      async resolveFold(request: IFoldRequest): Promise<IFoldResolution> {
        double.calls.push({ operation: 'fold', lease: request.lease, requestKey: request.requestKey, step: request.step.slot });
        const settled = await settleMembers('contributor', 'summary');
        return Object.freeze({ over: foldOver, discovery: settled.discovery, members: settled.members, outcome: double.fold, diagnostics: settled.diagnostics });
      },
      async resolveOutcomeFold(request: IFoldRequest): Promise<IOutcomeFoldResolution> {
        double.calls.push({ operation: 'outcome-fold', lease: request.lease, requestKey: request.requestKey, step: request.step.slot });
        const settled = await settleMembers('contributor', 'summary');
        return Object.freeze({ over: foldOver, discovery: settled.discovery, members: settled.members, outcome: double.outcomeFold, diagnostics: settled.diagnostics });
      },
      async check(): Promise<ICheckOutcome> {
        double.calls.push({ operation: 'check' });
        await Promise.resolve();
        double.during?.();
        return Object.freeze({ kind: 'execution-required', step, misses: [] });
      },
      recover(request): IRecoveryResult {
        double.calls.push({ operation: 'recover', requestKey: request.requestKey });
        double.during?.();
        return Object.freeze({ kind: 'absent' });
      },
    };
  };
  return { double, factory };
}

/** A writer double recording lease and release calls. */
function recordingWriter(options: { readonly unavailable?: boolean; readonly releaseThrows?: boolean } = {}): {
  readonly writer: IRunOptions['writer'];
  readonly leases: IRunLease[];
  readonly releases: { count: number };
} {
  const leases: IRunLease[] = [];
  const releases = { count: 0 };
  return {
    leases,
    releases,
    writer: {
      tryLease(): IWriterAttempt {
        if (options.unavailable === true) {
          return Object.freeze({ kind: 'held', holder: 'run:other', expiresAt: 10_000 });
        }
        const lease = Object.freeze({ holder: 'run:test', fence: leases.length + 1, expiresAt: 10_000 });
        leases.push(lease);
        return Object.freeze({ kind: 'acquired', lease });
      },
      release(): void {
        releases.count += 1;
        if (options.releaseThrows === true) {
          throw new Error('storage closed underneath the run');
        }
      },
    },
  };
}

/** Minimal run options over the recording doubles. */
function runOptions(overrides: Partial<IRunOptions> = {}): { readonly options: IRunOptions; readonly double: IDouble; readonly writer: ReturnType<typeof recordingWriter> } {
  const { double, factory } = recordingResolution();
  const writer = recordingWriter();
  return {
    double,
    writer,
    options: { analysis: 'analysis:test', environment: 'env:test', resolution: factory, writer: writer.writer, ...overrides },
  };
}

/** A fresh Supervision over Node's real asynchronous scope. */
function supervision(): ISupervision {
  return createSupervision({ context: nodeScopes });
}

describe('scoped run context (RUN-001, DOM-2)', () => {
  test('lookup outside any live run fails clearly', async () => {
    await expectSupervisionError(() => supervision().current(), 'outside-run');
  });

  test('the run context follows awaits inside the body and is frozen volatile metadata', async () => {
    const supervisor = supervision();
    const { options } = runOptions({ runId: 'run:explicit' });
    const seen: unknown[] = [];
    const result = await supervisor.run(options, async () => {
      seen.push(supervisor.current());
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(supervisor.current());
      await Promise.all([Promise.resolve().then(() => seen.push(supervisor.current()))]);
      return 'done';
    });
    expect(result.value).toBe('done');
    expect(result.context).toEqual({ runId: 'run:explicit', analysis: 'analysis:test', environment: 'env:test' });
    expect(seen).toEqual([result.context, result.context, result.context]);
    expect(Object.isFrozen(result.context)).toBe(true);
  });

  test('author code reached through a request looks up its run without a context parameter', async () => {
    const supervisor = supervision();
    const { options, double } = runOptions();
    const seen: unknown[] = [];
    double.during = () => {
      seen.push(supervisor.current().environment);
    };
    await supervisor.run(options, async (run) => {
      await run.resolve(step, { requestKey: 'request:1' });
      await run.check(step);
      await run.recover(step, { requestKey: 'request:1' });
    });
    expect(seen).toEqual(['env:test', 'env:test', 'env:test']);
  });

  test('two interleaved runs stay isolated across awaits', async () => {
    const supervisor = supervision();
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = supervisor.run(runOptions({ environment: 'env:first' }).options, async () => {
      order.push(`first:${supervisor.current().environment}`);
      await firstGate;
      order.push(`first:${supervisor.current().environment}`);
    });
    const second = supervisor.run(runOptions({ environment: 'env:second' }).options, async () => {
      order.push(`second:${supervisor.current().environment}`);
      releaseFirst();
      await Promise.resolve();
      order.push(`second:${supervisor.current().environment}`);
    });
    await Promise.all([first, second]);
    expect(order.filter((entry) => entry.startsWith('first:'))).toEqual(['first:env:first', 'first:env:first']);
    expect(order.filter((entry) => entry.startsWith('second:'))).toEqual(['second:env:second', 'second:env:second']);
  });

  test('a callback that escaped a closed run cannot look up its context or start new work', async () => {
    const supervisor = supervision();
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let escaped: ReturnType<typeof settled> | undefined;
    let kept: IRun | undefined;
    let closure: (() => unknown) | undefined;
    await supervisor.run(runOptions().options, (run) => {
      kept = run;
      // Scheduled inside the run, so it carries the run's scope when it fires after close.
      escaped = settled(gate.then(() => supervisor.current()));
      closure = () => supervisor.current();
    });
    openGate();
    expect(escaped).toBeDefined();
    expect(kept).toBeDefined();
    if (escaped === undefined || kept === undefined || closure === undefined) {
      return;
    }
    expect(settledCode(await escaped)).toBe('run-closed');
    // A closure merely called later from outside carries no run at all.
    await expectSupervisionError(closure, 'outside-run');
    const lateRun = kept;
    await expectSupervisionError(lateRun.resolve(step, { requestKey: 'request:late' }), 'run-closed');
    await expectSupervisionError(lateRun.check(step), 'run-closed');
    await expectSupervisionError(lateRun.recover(step, { requestKey: 'request:late' }), 'run-closed');
    await expectSupervisionError(lateRun.ordinary('late', () => 1), 'run-closed');
  });

  test('a body that throws still closes the run and releases its writer', async () => {
    const supervisor = supervision();
    const { options, writer } = runOptions();
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let escaped: ReturnType<typeof settled> | undefined;
    await expect(supervisor.run(options, async (run) => {
      await run.resolve(step, { requestKey: 'request:1' });
      escaped = settled(gate.then(() => supervisor.current()));
      throw new Error('body failed');
    })).rejects.toThrow('body failed');
    openGate();
    expect(escaped).toBeDefined();
    if (escaped !== undefined) {
      expect(settledCode(await escaped)).toBe('run-closed');
    }
    expect(writer.releases.count).toBe(1);
  });

  test('lookup while a composition is being constructed fails, even inside a live run', async () => {
    const supervisor = supervision();
    const { source, compose } = declarations<IBindingFamily & { readonly source: object; readonly memo: object }>();
    const activity = source<{ readonly value: string }>({ subject: 'activity:ada', run: () => ({ value: 'ada' }) });
    const lookups: unknown[] = [];
    await supervisor.run(runOptions().options, () => {
      const members = new Proxy([{ key: 'person:ada', steps: [{ slot: 'activity', declaration: activity }] }], {
        get(target, key, receiver): unknown {
          if (key === '0') {
            try {
              lookups.push(supervisor.current());
            } catch (error: unknown) {
              lookups.push(error);
            }
          }
          return Reflect.get(target, key, receiver);
        },
      });
      compose({ scope: 'analysis:test', members });
      lookups.push(supervisor.current());
    });
    expect(lookups.length).toBeGreaterThan(1);
    const during = lookups.slice(0, -1);
    expect(during.every((entry) => entry instanceof SupervisionError && entry.code === 'composition-phase')).toBe(true);
    expect(lookups.at(-1)).toMatchObject({ environment: 'env:test' });
  });

  test('a run cannot start while a composition is being constructed', async () => {
    const supervisor = supervision();
    const { source, compose } = declarations<IBindingFamily & { readonly source: object; readonly memo: object }>();
    const activity = source<{ readonly value: string }>({ subject: 'activity:ada', run: () => ({ value: 'ada' }) });
    let started: Promise<unknown> | undefined;
    const members = new Proxy([{ key: 'person:ada', steps: [{ slot: 'activity', declaration: activity }] }], {
      get(target, key, receiver): unknown {
        if (key === '0' && started === undefined) {
          started = supervisor.run(runOptions().options, () => 'ran');
        }
        return Reflect.get(target, key, receiver);
      },
    });
    compose({ scope: 'analysis:test', members });
    expect(started).toBeDefined();
    if (started !== undefined) {
      await expectSupervisionError(started, 'composition-phase');
    }
  });

  test('an observed run invoked during composition remains unprepared after the proxy returns', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { source, compose } = declarations<IBindingFamily & { readonly source: object; readonly memo: object }>();
      const activity = source<{ readonly value: string }>({ subject: 'activity:ada', run: () => ({ value: 'ada' }) });
      const location = join(directory, 'during-composition.sqlite');
      let observed: ReturnType<typeof supervisor.startObserved> | undefined;
      let bodies = 0;
      const members = new Proxy([{ key: 'person:ada', steps: [{ slot: 'activity', declaration: activity }] }], {
        get(target, key, receiver): unknown {
          if (key === '0' && observed === undefined) {
            observed = supervisor.startObserved({ ...runOptions().options, observationLocation: location }, () => { bodies += 1; return 'ran'; });
          }
          return Reflect.get(target, key, receiver);
        },
      });
      compose({ scope: 'analysis:test', members });
      expect(observed).toBeDefined();
      if (observed !== undefined) {
        await expectSupervisionError(observed.result, 'composition-phase');
        expect(await observed.acknowledgment).toEqual({ kind: 'unprepared' });
      }
      expect(bodies).toBe(0);
      expect(existsSync(location)).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('malformed run options are rejected before a run starts', async () => {
    const supervisor = supervision();
    await expectSupervisionError(supervisor.run(runOptions({ environment: '' }).options, () => 1), 'invalid-request');
    await expectSupervisionError(supervisor.run(runOptions({ analysis: '' }).options, () => 1), 'invalid-request');
    await expectSupervisionError(supervisor.run(runOptions({ runId: '' }).options, () => 1), 'invalid-request');
  });
});

describe('writer ownership', () => {
  test('only normal requests take the writer lease, which is released once when the run closes', async () => {
    const supervisor = supervision();
    const { options, double, writer } = runOptions();
    await supervisor.run(options, async (run) => {
      await run.check(step);
      await run.recover(step, { requestKey: 'request:0' });
      expect(writer.leases).toHaveLength(0);
      await run.resolve(step, { requestKey: 'request:1' });
      await run.resolve(step, { requestKey: 'request:2' });
    });
    expect(writer.leases).toHaveLength(2);
    expect(double.calls.filter((call) => call.operation === 'resolve').map((call) => call.lease)).toEqual(writer.leases);
    expect(double.calls.map((call) => call.requestKey)).toEqual([undefined, 'request:0', 'request:1', 'request:2']);
    expect(writer.releases.count).toBe(1);
  });

  test('a writer held past the operator deadline fails that normal request as writer-busy without blocking check-only or recovery', async () => {
    const supervisor = createSupervision({ context: nodeScopes, timer: { currentEpochMilliseconds: () => 20_000, schedule: () => () => undefined } });
    const { double, factory } = recordingResolution();
    const writer = recordingWriter({ unavailable: true });
    await supervisor.run({ analysis: 'analysis:test', environment: 'env:test', resolution: factory, writer: writer.writer, writerWait: { deadline: 20_000 } }, async (run) => {
      await expectSupervisionError(run.resolve(step, { requestKey: 'request:1' }), 'writer-busy');
      await expect(run.check(step)).resolves.toMatchObject({ kind: 'execution-required' });
      await expect(run.recover(step, { requestKey: 'request:1' })).resolves.toEqual({ kind: 'absent' });
    });
    expect(double.calls.map((call) => call.operation)).toEqual(['check', 'recover']);
  });

  test('a writer that cannot be released becomes a diagnostic beside the run result', async () => {
    const supervisor = supervision();
    const { factory } = recordingResolution();
    const writer = recordingWriter({ releaseThrows: true });
    const result = await supervisor.run({ analysis: 'analysis:test', environment: 'env:test', resolution: factory, writer: writer.writer }, () => 'value');
    expect(result.value).toBe('value');
    expect(result.diagnostics).toEqual([expect.stringContaining('storage closed underneath the run')]);
  });
});

describe('admission (REUSE-009, A-19)', () => {
  test('without a policy, work Resolution presents is admitted', async () => {
    const supervisor = supervision();
    const { options, double } = runOptions();
    await supervisor.run(options, (run) => run.resolve(step, { requestKey: 'request:1' }));
    expect(double.decisions).toEqual([{ kind: 'admitted' }]);
  });

  test('the caller policy decides admission, and its denial reaches Resolution unchanged', async () => {
    const supervisor = supervision();
    const requests: IAdmissionRequest[] = [];
    const { options, double } = runOptions({
      admission: {
        admit(request: IAdmissionRequest): IAdmissionDecision {
          requests.push(request);
          return { kind: 'denied', reason: 'budget exhausted' };
        },
      },
    });
    const result = await supervisor.run(options, (run) => run.resolve(step, { requestKey: 'request:1' }));
    expect(result.value).toMatchObject({ kind: 'refused', reason: 'budget exhausted' });
    expect(requests).toHaveLength(1);
    expect(double.decisions).toEqual([{ kind: 'denied', reason: 'budget exhausted' }]);
  });

  test('work presented after the run closed is denied without consulting the policy', async () => {
    const supervisor = supervision();
    let consulted = 0;
    const { options, double } = runOptions({ admission: { admit: () => { consulted += 1; return { kind: 'admitted' }; } } });
    await supervisor.run(options, () => undefined);
    const ports = double.ports;
    expect(ports).toBeDefined();
    if (ports === undefined) {
      return;
    }
    const decision = await ports.admission.admit(Object.freeze({ step, kind: 'memo', subject: { analysis: 'analysis:test', environment: 'env:test', subject: 's', version: 1 }, reason: 'cold' }));
    expect(decision).toEqual({ kind: 'denied', reason: expect.stringContaining('closed') });
    expect(consulted).toBe(0);
  });
});

describe('observer positions (REUSE-009, A-19)', () => {
  test('the fixed step and ordinary positions are published, ordered and immutable', () => {
    expect(stepLifecycle).toEqual(['verify', 'finality', 'admit', 'refuse', 'claim', 'execute', 'publish', 'accept', 'release', 'abandon']);
    expect(ordinaryLifecycle).toEqual(['begin', 'end', 'fail']);
    expect(Object.isFrozen(stepLifecycle)).toBe(true);
    expect(Object.isFrozen(ordinaryLifecycle)).toBe(true);
    expect(() => Reflect.apply(Array.prototype.push, stepLifecycle, ['middleware'])).toThrow(TypeError);
  });

  test('every observer sees each step event, frozen and naming its run', async () => {
    const supervisor = supervision();
    const first: IRunEvent[] = [];
    const second: IRunEvent[] = [];
    const { options } = runOptions({ runId: 'run:observed', observers: [{ observe: (event) => first.push(event) }, { observe: (event) => second.push(event) }] });
    await supervisor.run(options, (run) => run.resolve(step, { requestKey: 'request:1' }));
    expect(first.map((event) => event.kind === 'step' ? event.event.phase : event.kind === 'stop' ? event.level : event.kind === 'promotion' ? event.kind : event.phase)).toEqual(['verify', 'admit', 'claim', 'execute', 'publish']);
    expect(second).toEqual(first);
    expect(first.every((event) => Object.isFrozen(event) && event.runId === 'run:observed')).toBe(true);
  });

  test('an observer failure reaches Resolution after every observer has seen the event', async () => {
    const supervisor = supervision();
    const later: string[] = [];
    const { options } = runOptions({
      observers: [
        { observe: (event) => { if (event.kind === 'step' && event.event.phase === 'publish') { throw new Error('first observer AUTHOR-SECRET'); } } },
        { observe: (event) => { if (event.kind === 'step') { later.push(event.event.phase); } } },
      ],
    });
    const result = await supervisor.run(options, (run) => run.resolve(step, { requestKey: 'request:1' }));
    expect(later).toContain('publish');
    expect(result.value).toMatchObject({ kind: 'published', reference });
    // The diagnostic names the position; the observer's own error text never enters it (RUN-013).
    expect(result.diagnostics).toEqual([expect.stringContaining('publish')]);
    expect(result.diagnostics.join('\n')).not.toContain('AUTHOR-SECRET');
  });

  test('observers are captured when the run starts, and their return values never veto work', async () => {
    const supervisor = supervision();
    const original: string[] = [];
    const replaced: string[] = [];
    const observer: IRunObserver = {
      observe(event: IRunEvent): void {
        original.push(event.kind);
      },
    };
    const vetoing = { observe: (): unknown => ({ kind: 'denied', reason: 'observer says no' }) };
    const { options, double } = runOptions({ observers: [observer, vetoing] });
    await supervisor.run(options, async (run) => {
      observer.observe = (event: IRunEvent): void => {
        replaced.push(event.kind);
      };
      await run.resolve(step, { requestKey: 'request:1' });
    });
    expect(original.length).toBeGreaterThan(0);
    expect(replaced).toEqual([]);
    expect(double.decisions).toEqual([{ kind: 'admitted' }]);
  });

  test('run diagnostics collect each request\'s post-commit diagnostics once', async () => {
    const supervisor = supervision();
    const { options, double } = runOptions();
    double.diagnostics = ['child observer failed after commit'];
    const result = await supervisor.run(options, async (run) => {
      await run.resolve(step, { requestKey: 'request:1' });
    });
    expect(result.diagnostics).toEqual(['child observer failed after commit']);
  });
});

describe('ordinary nonmemoized work (DOM-2, REUSE-009)', () => {
  test('ordinary work runs in the run scope, is observed at begin and end, and has no reference', async () => {
    const supervisor = supervision();
    const events: IRunEvent[] = [];
    const { options, double } = runOptions({ runId: 'run:ordinary', observers: [{ observe: (event) => events.push(event) }] });
    const result = await supervisor.run(options, (run) => run.ordinary('report', async () => {
      await Promise.resolve();
      return `report for ${supervisor.current().environment}`;
    }));
    expect(result.value).toBe('report for env:test');
    expect(events).toEqual([
      { kind: 'ordinary', runId: 'run:ordinary', label: 'report', phase: 'begin' },
      { kind: 'ordinary', runId: 'run:ordinary', label: 'report', phase: 'end' },
    ]);
    expect(double.calls).toEqual([]);
  });

  test('an observer failure at begin stops only that call before its work runs', async () => {
    const supervisor = supervision();
    const thrown = new Error('begin AUTHOR-SECRET');
    let ran = 0;
    const { options } = runOptions({
      observers: [{ observe: (event) => { if (event.kind === 'ordinary' && event.phase === 'begin' && event.label === 'first') { throw thrown; } } }],
    });
    const result = await supervisor.run(options, async (run) => {
      const failure = await run.ordinary('first', () => { ran += 1; }).then(() => undefined, (error: unknown) => error);
      expect(failure).toBeInstanceOf(SupervisionError);
      // The failure names the work; the observer's error is its cause and never its message (RUN-013).
      expect(failure instanceof SupervisionError ? [failure.code, failure.cause] : undefined).toEqual(['observer-failure', thrown]);
      expect(failure instanceof Error ? failure.message : '').toContain('first');
      expect(failure instanceof Error ? failure.message : '').not.toContain('AUTHOR-SECRET');
      return run.ordinary('second', () => { ran += 1; return 'second ran'; });
    });
    expect(ran).toBe(1);
    expect(result.value).toBe('second ran');
  });

  test('an observer failure after ordinary work finished is a diagnostic beside its value', async () => {
    const supervisor = supervision();
    const { options } = runOptions({
      observers: [{ observe: (event) => { if (event.kind === 'ordinary' && event.phase === 'end') { throw new Error('end AUTHOR-SECRET'); } } }],
    });
    const result = await supervisor.run(options, (run) => run.ordinary('report', () => 'value'));
    expect(result.value).toBe('value');
    expect(result.diagnostics).toEqual([expect.stringContaining('report')]);
    expect(result.diagnostics.join('\n')).not.toContain('AUTHOR-SECRET');
  });

  test('failing ordinary work is observed as fail and its own error is preserved', async () => {
    const supervisor = supervision();
    const events: string[] = [];
    const { options } = runOptions({ observers: [{ observe: (event) => { if (event.kind === 'ordinary') { events.push(event.phase); } } }] });
    const failure = new Error('assembly failed');
    await supervisor.run(options, async (run) => {
      await expect(run.ordinary('report', () => { throw failure; })).rejects.toBe(failure);
    });
    expect(events).toEqual(['begin', 'fail']);
  });

  test('ordinary work needs a nonempty label', async () => {
    const supervisor = supervision();
    await supervisor.run(runOptions().options, async (run) => {
      await expectSupervisionError(run.ordinary('', () => 1), 'invalid-request');
    });
  });
});

/** A gate a test opens explicitly. */
function gate(): { readonly opened: Promise<void>; open(): void } {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** Let pending microtasks and timers run, so a run that should wait is observably still pending. */
async function settleTicks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** The member outcome of `key` in a report, or a failure naming what was there. */
function memberOf(members: readonly IMemberOutcome[], key: string): IMemberOutcome {
  const found = members.find((member) => member.key === key);
  if (found === undefined) {
    throw new Error(`no member ${key} among ${members.map((member) => member.key).join(', ')}`);
  }
  return found;
}

/** An admission policy that decides by the requested instance's member key; everything else is admitted. */
function policyByMember(decisions: Readonly<Record<string, IAdmissionDecision>>): NonNullable<IRunOptions['admission']> {
  return {
    admit(request: IAdmissionRequest): IAdmissionDecision {
      const key = request.step.memberKey;
      return (key === undefined ? undefined : decisions[key]) ?? { kind: 'admitted' };
    },
  };
}

describe('typed member outcomes (CMP-8, RUN-005, RUN-010)', () => {
  test('succeeded, skipped, pending, failed and cancelled members stay distinct in one run with discovery open', async () => {
    const { options, double } = runOptions({
      admission: policyByMember({
        'person:cy': { kind: 'denied', reason: 'quota exhausted for now' },
        'person:eve': { kind: 'cancelled', reason: 'operator stopped this member' },
      }),
    });
    double.members = [
      { key: 'person:eve', gate: 'required', body: 'publishes' },
      { key: 'person:dee', gate: 'failed' },
      { key: 'person:cy', gate: 'required', body: 'publishes' },
      { key: 'person:ben', gate: 'skipped' },
      { key: 'person:ada', gate: 'required', body: 'publishes' },
      { key: 'person:fay', gate: 'required', body: 'fails' },
    ];
    const result = await supervision().run(options, (run) => run.resolveMembers({ template: 'contributor', step: 'summary' }, { requestKey: 'request:members' }));
    const report = result.value;
    expect(report.template).toBe('contributor');
    expect(report.step).toBe('summary');
    expect(report.discovery).toMatchObject({ kind: 'keyed', completion: 'open', keys: ['person:ada', 'person:ben', 'person:cy', 'person:dee', 'person:eve', 'person:fay'] });
    // Canonical key order, whatever order discovery listed them in.
    expect(report.members.map((member) => [member.key, member.status])).toEqual([
      ['person:ada', 'succeeded'],
      ['person:ben', 'skipped'],
      ['person:cy', 'pending'],
      ['person:dee', 'failed'],
      ['person:eve', 'cancelled'],
      ['person:fay', 'failed'],
    ]);
    const ada = memberOf(report.members, 'person:ada');
    expect(ada.status === 'succeeded' ? ada.outcome.reference.locator : undefined).toBe('mdh1:test:person:ada');
    // A skip carries its gate evidence and no result at all.
    expect(memberOf(report.members, 'person:ben')).toEqual({
      status: 'skipped',
      key: 'person:ben',
      step: expect.objectContaining({ memberKey: 'person:ben', template: 'contributor' }),
      gate: { selected: 'skipped', observations: [] },
    });
    expect(memberOf(report.members, 'person:cy')).toMatchObject({ status: 'pending', reason: 'quota exhausted for now', refused: { memberKey: 'person:cy' } });
    expect(memberOf(report.members, 'person:eve')).toMatchObject({ status: 'cancelled', reason: 'operator stopped this member', refused: { memberKey: 'person:eve' } });
    const dee = memberOf(report.members, 'person:dee');
    const fay = memberOf(report.members, 'person:fay');
    expect(dee.status === 'failed' ? dee.error.code : undefined).toBe('gate-failure');
    expect(fay.status === 'failed' ? fay.error.code : undefined).toBe('execution-failure');
    // The cancellation reached Resolution as its own decision kind, never as a denial.
    expect(double.decisions.map((decision) => decision.kind)).toEqual(['admitted', 'denied', 'cancelled', 'admitted']);
  });

  test('a members request is a normal request: it takes the writer lease and the caller request key, and runs in the run scope', async () => {
    const supervisor = supervision();
    const { options, double, writer } = runOptions();
    double.members = [{ key: 'person:ada', gate: 'required', body: 'publishes' }];
    const seen: string[] = [];
    double.during = () => {
      seen.push(supervisor.current().environment);
    };
    await supervisor.run(options, (run) => run.resolveMembers({ template: 'contributor', step: 'summary' }, { requestKey: 'request:members' }));
    expect(double.calls).toEqual([{ operation: 'members', lease: writer.leases[0], requestKey: 'request:members', template: 'contributor', step: 'summary' }]);
    expect(seen).toEqual(['env:test']);
    expect(writer.releases.count).toBe(1);
  });

  test('refused discovery is pending or cancelled with no member outcomes; a rejected snapshot carries its keying diagnostic', async () => {
    for (const [decision, status] of [
      [{ kind: 'denied', reason: 'discovery quota' }, 'pending'],
      [{ kind: 'cancelled', reason: 'discovery withdrawn' }, 'cancelled'],
    ] as const) {
      const { options, double } = runOptions({ admission: { admit: () => decision } });
      double.discovery = 'admission';
      double.members = [{ key: 'person:ada', gate: 'required', body: 'publishes' }];
      const result = await supervision().run(options, (run) => run.resolveMembers({ template: 'contributor', step: 'summary' }, { requestKey: 'request:members' }));
      expect(result.value.discovery).toEqual({ kind: status, collection: expect.objectContaining({ slot: 'contributors' }), refused: expect.objectContaining({ slot: 'contributors' }), reason: decision.reason });
      expect(result.value.members).toEqual([]);
    }
    const { options, double } = runOptions();
    double.discovery = 'rejected';
    double.members = [{ key: 'person:ada', gate: 'required', body: 'publishes' }];
    const result = await supervision().run(options, (run) => run.resolveMembers({ template: 'contributor', step: 'summary' }, { requestKey: 'request:members' }));
    expect(result.value.discovery).toMatchObject({ kind: 'rejected', diagnostic: { reason: 'duplicate-key', key: 'person:ada', collection: 'contributors' } });
    expect(result.value.members).toEqual([]);
    expect(double.decisions).toEqual([]);
  });

  test('members request diagnostics join the run diagnostics once', async () => {
    const { options, double } = runOptions();
    double.members = [{ key: 'person:ada', gate: 'required', body: 'publishes' }];
    double.diagnostics = ['observer failed after a member publication committed'];
    const result = await supervision().run(options, (run) => run.resolveMembers({ template: 'contributor', step: 'summary' }, { requestKey: 'request:members' }));
    expect(result.diagnostics).toEqual(['observer failed after a member publication committed']);
  });

  test('a members request after the run closed is rejected as new work', async () => {
    const { options } = runOptions();
    let escaped: IRun | undefined;
    await supervision().run(options, (run) => {
      escaped = run;
    });
    if (escaped === undefined) {
      throw new Error('the run body did not run');
    }
    await expectSupervisionError(escaped.resolveMembers({ template: 'contributor', step: 'summary' }, { requestKey: 'request:late' }), 'run-closed');
  });
});

describe('typed strict fold outcomes (CMP-8, RUN-005, RUN-010)', () => {
  /** A fold request through one fresh run over the doubles, with `fold` as Resolution's fold outcome. */
  async function foldReport(fold: IFoldOutcome, overrides: Partial<IRunOptions> = {}): Promise<{ readonly report: IFoldReport; readonly double: IDouble }> {
    const { options, double } = runOptions(overrides);
    double.members = [
      { key: 'person:ben', gate: 'skipped' },
      { key: 'person:ada', gate: 'required', body: 'publishes' },
    ];
    double.fold = fold;
    const result = await supervision().run(options, (run) => run.resolveFold(foldStep, { requestKey: 'request:fold' }));
    return { report: result.value, double };
  }

  test('a succeeded fold keeps its exact outcome and framework coverage beside discovery and every member outcome', async () => {
    const coverage = Object.freeze({ required: ['person:ada'], skipped: ['person:ben'], closed: true as const });
    const published: IFoldOutcome = Object.freeze({ ...noFoldWork, kind: 'published', reference: Object.freeze({ kind: 'completed-result' as const, locator: 'mdh1:test:report' }), attemptId: 7, coverage });
    const { report } = await foldReport(published);
    expect(report.fold).toBe(foldStep);
    expect(report.over).toBe(foldOver);
    expect(report.discovery).toMatchObject({ kind: 'keyed', keys: ['person:ada', 'person:ben'] });
    expect(report.members.map((member) => [member.key, member.status])).toEqual([['person:ada', 'succeeded'], ['person:ben', 'skipped']]);
    expect(report.outcome).toEqual({ status: 'succeeded', outcome: published });
    expect(report.outcome.status === 'succeeded' ? report.outcome.outcome.coverage : undefined).toBe(coverage);
  });

  test('waiting and failed folds keep their key lists and open discovery distinct', async () => {
    const waiting = await foldReport(Object.freeze({ ...noFoldWork, kind: 'waiting', pending: ['person:cy'], openDiscovery: false }));
    expect(waiting.report.outcome).toEqual({ status: 'waiting', pending: ['person:cy'], openDiscovery: false });
    const failed = await foldReport(Object.freeze({
      ...noFoldWork,
      kind: 'failed',
      failed: ['person:dee'],
      cancelled: ['person:eve'],
      pending: ['person:cy'],
      openDiscovery: true,
      diagnostic: 'strict fold report cannot complete',
    }));
    expect(failed.report.outcome).toEqual({
      status: 'failed',
      failed: ['person:dee'],
      cancelled: ['person:eve'],
      pending: ['person:cy'],
      openDiscovery: true,
      diagnostic: 'strict fold report cannot complete',
    });
  });

  test('the fold\'s own refused work is pending when denied and cancelled when cancelled, never failed', async () => {
    for (const [disposition, status] of [['denied', 'pending'], ['cancelled', 'cancelled']] as const) {
      const { report } = await foldReport(Object.freeze({ ...noFoldWork, kind: 'refused', refused: foldStep, reason: `fold work ${disposition}`, disposition }));
      expect(report.outcome).toEqual({ status, refused: foldStep, reason: `fold work ${disposition}` });
    }
  });

  test('member outcomes and refused discovery inside a fold report are classified as in a members report', async () => {
    const { options, double } = runOptions({ admission: { admit: () => ({ kind: 'cancelled', reason: 'discovery withdrawn' }) } });
    double.discovery = 'admission';
    double.fold = Object.freeze({ ...noFoldWork, kind: 'failed', failed: [], cancelled: [], pending: [], openDiscovery: true, diagnostic: 'discovery was cancelled' });
    const result = await supervision().run(options, (run) => run.resolveFold(foldStep, { requestKey: 'request:fold' }));
    expect(result.value.discovery).toEqual({ kind: 'cancelled', collection: expect.objectContaining({ slot: 'contributors' }), refused: expect.objectContaining({ slot: 'contributors' }), reason: 'discovery withdrawn' });
    expect(result.value.members).toEqual([]);
    expect(result.value.outcome).toMatchObject({ status: 'failed', openDiscovery: true });
  });

  test('a fold request is a normal request: it takes the writer lease and the caller request key, runs in the run scope, and joins diagnostics once', async () => {
    const supervisor = supervision();
    const { options, double, writer } = runOptions();
    double.members = [{ key: 'person:ada', gate: 'required', body: 'publishes' }];
    double.diagnostics = ['observer failed after a member publication committed'];
    const seen: string[] = [];
    double.during = () => {
      seen.push(supervisor.current().environment);
    };
    const result = await supervisor.run(options, (run) => run.resolveFold(foldStep, { requestKey: 'request:fold' }));
    expect(double.calls).toEqual([{ operation: 'fold', lease: writer.leases[0], requestKey: 'request:fold', step: 'report' }]);
    expect(seen).toEqual(['env:test']);
    expect(result.diagnostics).toEqual(['observer failed after a member publication committed']);
    expect(writer.releases.count).toBe(1);
  });

  test('a fold request after the run closed is rejected as new work', async () => {
    const { options } = runOptions();
    let escaped: IRun | undefined;
    await supervision().run(options, (run) => {
      escaped = run;
    });
    if (escaped === undefined) {
      throw new Error('the run body did not run');
    }
    await expectSupervisionError(escaped.resolveFold(foldStep, { requestKey: 'request:late' }), 'run-closed');
  });
});

describe('typed outcome fold outcomes (RUN-010)', () => {
  /** An outcome fold request through one fresh run over the doubles, with `outcome` as Resolution's outcome fold outcome. */
  async function outcomeReport(outcome: IOutcomeFoldOutcome): Promise<{ readonly report: IOutcomeFoldReport; readonly double: IDouble; readonly writer: ReturnType<typeof recordingWriter> }> {
    const { options, double, writer } = runOptions();
    double.members = [
      { key: 'person:ben', gate: 'skipped' },
      { key: 'person:ada', gate: 'required', body: 'publishes' },
      { key: 'person:cy', gate: 'required', body: 'fails' },
    ];
    double.outcomeFold = outcome;
    const result = await supervision().run(options, (run) => run.resolveOutcomeFold(foldStep, { requestKey: 'request:outcome-fold' }));
    return { report: result.value, double, writer };
  }

  /** Complete coverage of Ada succeeded, Ben skipped and Cy failed. */
  const complete = Object.freeze({ ...emptyCoverage, succeeded: ['person:ada'], skipped: ['person:ben'], failed: ['person:cy'], pending: [] as const, openDiscovery: false as const, complete: true as const });

  test('a folded outcome keeps its exact outcome and complete coverage, failures included, beside every member outcome', async () => {
    const published: IOutcomeFoldOutcome = Object.freeze({ ...noFoldWork, kind: 'published', reference: Object.freeze({ kind: 'completed-result' as const, locator: 'mdh1:test:tally' }), attemptId: 9, coverage: complete });
    const { report, double, writer } = await outcomeReport(published);
    expect(double.calls).toEqual([{ operation: 'outcome-fold', lease: writer.leases[0], requestKey: 'request:outcome-fold', step: 'report' }]);
    expect(report.fold).toBe(foldStep);
    expect(report.over).toBe(foldOver);
    expect(report.members.map((member) => [member.key, member.status])).toEqual([['person:ada', 'succeeded'], ['person:ben', 'skipped'], ['person:cy', 'failed']]);
    expect(report.outcome).toEqual({ status: 'folded', outcome: published });
    expect(report.outcome.status === 'folded' ? report.outcome.outcome.coverage : undefined).toBe(complete);
  });

  test('a waiting outcome fold keeps its partial coverage; a population that cannot be established fails', async () => {
    const partial = Object.freeze({ ...emptyCoverage, succeeded: ['person:ada'], failed: ['person:cy'], pending: ['person:dee'], openDiscovery: true, complete: false as const });
    const waiting = await outcomeReport(Object.freeze({ ...noFoldWork, kind: 'waiting', coverage: partial }));
    expect(waiting.report.outcome).toEqual({ status: 'waiting', coverage: partial });
    const failed = await outcomeReport(Object.freeze({ ...noFoldWork, kind: 'failed', diagnostic: 'discovery was rejected' }));
    expect(failed.report.outcome).toEqual({ status: 'failed', diagnostic: 'discovery was rejected' });
  });

  test('the outcome fold\'s own refused work is pending when denied and cancelled when cancelled, with the coverage it would have folded', async () => {
    for (const [disposition, status] of [['denied', 'pending'], ['cancelled', 'cancelled']] as const) {
      const { report } = await outcomeReport(Object.freeze({ ...noFoldWork, kind: 'refused', refused: foldStep, reason: `fold work ${disposition}`, disposition, coverage: complete }));
      expect(report.outcome).toEqual({ status, refused: foldStep, reason: `fold work ${disposition}`, coverage: complete });
    }
  });

  test('an outcome fold request after the run closed is rejected as new work', async () => {
    const { options } = runOptions();
    let escaped: IRun | undefined;
    await supervision().run(options, (run) => {
      escaped = run;
    });
    if (escaped === undefined) {
      throw new Error('the run body did not run');
    }
    await expectSupervisionError(escaped.resolveOutcomeFold(foldStep, { requestKey: 'request:late' }), 'run-closed');
  });
});

describe('lifetime of operations the run already started (RUN-001)', () => {
  test('a body whose awaited Promise.all rejects early keeps the run live until its started sibling settles', async () => {
    // Regression (supervisory review P1): the run closed, released its writer
    // and snapshotted diagnostics when only its body settled, while an ordinary
    // operation the body had started (and awaited through Promise.all) was
    // still active; that operation then resumed in a closed run.
    const supervisor = supervision();
    const held = gate();
    const order: string[] = [];
    const { options, writer } = runOptions({ observers: [{ observe: (event) => { if (event.kind === 'ordinary') { order.push(`${event.label}:${event.phase}`); } } }] });
    let slowSaw: unknown;
    let settled = false;
    const running = supervisor.run(options, async (run) => {
      await run.resolve(step, { requestKey: 'request:1' });
      const slow = run.ordinary('slow', async () => {
        await held.opened;
        slowSaw = supervisor.current();
        return 'slow done';
      });
      return Promise.all([slow, run.ordinary('failing', () => { throw new Error('sibling failed'); })]);
    }).finally(() => {
      settled = true;
      order.push('run settled');
    });
    const outcome = settled_(running);
    await settleTicks();
    expect(settled).toBe(false);
    expect(writer.releases.count).toBe(0);
    held.open();
    const result = await outcome;
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error instanceof Error ? result.error.message : '').toBe('sibling failed');
    expect(slowSaw).toMatchObject({ analysis: 'analysis:test', environment: 'env:test' });
    expect(order).toEqual(['slow:begin', 'failing:begin', 'failing:fail', 'slow:end', 'run settled']);
    expect(writer.releases.count).toBe(1);
  });

  test('a body that returns before a started operation settles reports that operation\'s diagnostics', async () => {
    const supervisor = supervision();
    const held = gate();
    const { options, writer } = runOptions({
      observers: [{ observe: (event) => { if (event.kind === 'ordinary' && event.label === 'slow' && event.phase === 'end') { throw new Error('slow end observer failed'); } } }],
    });
    let settled = false;
    const running = supervisor.run(options, async (run) => Promise.race([
      run.ordinary('slow', async () => { await held.opened; return 'slow'; }),
      run.ordinary('fast', () => 'fast'),
    ])).finally(() => {
      settled = true;
    });
    await settleTicks();
    expect(settled).toBe(false);
    expect(writer.releases.count).toBe(0);
    held.open();
    const result = await running;
    expect(result.value).toBe('fast');
    expect(result.diagnostics).toEqual([expect.stringContaining('end of ordinary work slow')]);
    expect(writer.releases.count).toBe(1);
  });

  test('an asynchronous admission for already-started work completes while the run is still live', async () => {
    const supervisor = supervision();
    const held = gate();
    const asked: string[] = [];
    const { options, double, writer } = runOptions({
      admission: {
        async admit(): Promise<IAdmissionDecision> {
          asked.push(`asked, released ${String(releases())}`);
          await held.opened;
          asked.push(`answered, released ${String(releases())}`);
          return { kind: 'admitted' };
        },
      },
    });
    const releases = (): number => writer.releases.count;
    const running = settled_(supervisor.run(options, async (run) => Promise.all([
      run.resolve(step, { requestKey: 'request:1' }),
      run.ordinary('failing', () => { throw new Error('sibling failed'); }),
    ])));
    await settleTicks();
    held.open();
    const result = await running;
    expect(result.error instanceof Error ? result.error.message : '').toBe('sibling failed');
    expect(asked).toEqual(['asked, released 0', 'answered, released 0']);
    expect(double.decisions).toEqual([{ kind: 'admitted' }]);
    expect(writer.releases.count).toBe(1);
  });

  test('an admission decision that arrives after the run actually closed is denied', async () => {
    const supervisor = supervision();
    const held = gate();
    const { options, double } = runOptions({
      admission: {
        async admit(): Promise<IAdmissionDecision> {
          await held.opened;
          return { kind: 'admitted' };
        },
      },
    });
    let late: Promise<IAdmissionDecision> | undefined;
    await supervisor.run(options, () => {
      // Presented directly through the port, outside any operation the run tracks.
      const ports = double.ports;
      if (ports !== undefined) {
        late = Promise.resolve(ports.admission.admit(Object.freeze({ step, kind: 'memo', subject: { analysis: 'analysis:test', environment: 'env:test', subject: 's', version: 1 }, reason: 'cold' })));
      }
    });
    held.open();
    expect(late).toBeDefined();
    if (late !== undefined) {
      expect(await late).toEqual({ kind: 'denied', reason: expect.stringContaining('closed') });
    }
  });

  test('work an operation starts while the run waits for it is part of the run; work after actual closure is rejected', async () => {
    const supervisor = supervision();
    const held = gate();
    const { options } = runOptions();
    let kept: IRun | undefined;
    let nested: unknown;
    const result = await settled_(supervisor.run(options, async (run) => {
      kept = run;
      const slow = run.ordinary('slow', async () => {
        await held.opened;
        nested = await run.ordinary('nested', () => supervisor.current().environment);
      });
      setTimeout(() => held.open(), 5);
      return Promise.all([slow, run.ordinary('failing', () => { throw new Error('sibling failed'); })]);
    }));
    expect(result.error instanceof Error ? result.error.message : '').toBe('sibling failed');
    expect(nested).toBe('env:test');
    expect(kept?.open).toBe(false);
    if (kept !== undefined) {
      await expectSupervisionError(kept.ordinary('late', () => 1), 'run-closed');
    }
  });
});

/**
 * Classify one late operation against the closure boundary: it must either
 * never start (no `begin`, rejected `run-closed`) or participate fully (its
 * `begin` and ending both precede the writer release and run settlement).
 * An accepted operation still active after closure is the defect.
 */
function boundaryClass(events: readonly string[], label: string, outcome: { readonly error?: unknown }): 'rejected' | 'participated' | 'accepted-but-unaccounted' {
  const begin = events.indexOf(`${label}:begin`);
  const ended = Math.max(events.indexOf(`${label}:end`), events.indexOf(`${label}:fail`));
  const release = events.indexOf('writer:release');
  const settled = events.indexOf('run:settled');
  if (begin < 0) {
    return outcome.error instanceof SupervisionError && outcome.error.code === 'run-closed' ? 'rejected' : 'accepted-but-unaccounted';
  }
  return ended >= 0 && ended < release && ended < settled && outcome.error === undefined ? 'participated' : 'accepted-but-unaccounted';
}

describe('closure boundary (RUN-001)', () => {
  test('work started in any microtask around the final quiescence check is rejected or fully participates', async () => {
    // Regression (supervisory review of 9637739): the run observed no started
    // work, then yielded before closing; an ordinary call queued in that gap
    // was accepted and began, but the run released its writer and settled
    // while it was still active, and it later failed run-closed.
    const classes: string[] = [];
    for (let depth = 0; depth <= 12; depth += 1) {
      const supervisor = supervision();
      const held = gate();
      const events: string[] = [];
      const writer = { tryLease: (): IWriterAttempt => Object.freeze({ kind: 'acquired', lease: Object.freeze({ holder: 'h', fence: 1, expiresAt: 1 }) }), release: (): void => { events.push('writer:release'); } };
      const { factory } = recordingResolution();
      let late: ReturnType<typeof settled_> | undefined;
      const running = supervisor.run({
        analysis: 'analysis:test', environment: 'env:test', resolution: factory, writer,
        observers: [{ observe: (event) => { if (event.kind === 'ordinary') { events.push(`${event.label}:${event.phase}`); } } }],
      }, (run) => {
        let chain = Promise.resolve();
        for (let index = 0; index < depth; index += 1) {
          chain = chain.then(() => undefined);
        }
        void chain.then(() => {
          late = settled_(run.ordinary('late', async () => {
            await held.opened;
            return supervisor.current().environment;
          }));
        });
        return 'body';
      }).finally(() => {
        events.push('run:settled');
      });
      await settleTicks();
      held.open();
      await running;
      const outcome = late === undefined ? { error: new Error('never called') } : await late;
      classes.push(`${String(depth)}:${boundaryClass(events, 'late', outcome)}`);
    }
    expect(classes.filter((entry) => entry.endsWith('accepted-but-unaccounted'))).toEqual([]);
  });

  test('nested work started by a participating operation near closure is rejected or fully participates', async () => {
    const classes: string[] = [];
    for (let depth = 0; depth <= 8; depth += 1) {
      const supervisor = supervision();
      const first = gate();
      const second = gate();
      const events: string[] = [];
      const writer = { tryLease: (): IWriterAttempt => Object.freeze({ kind: 'acquired', lease: Object.freeze({ holder: 'h', fence: 1, expiresAt: 1 }) }), release: (): void => { events.push('writer:release'); } };
      const { factory } = recordingResolution();
      let nested: ReturnType<typeof settled_> | undefined;
      const running = settled_(supervisor.run({
        analysis: 'analysis:test', environment: 'env:test', resolution: factory, writer,
        observers: [{ observe: (event) => { if (event.kind === 'ordinary') { events.push(`${event.label}:${event.phase}`); } } }],
      }, (run) => {
        const slow = run.ordinary('slow', async () => {
          await first.opened;
          let chain = Promise.resolve();
          for (let index = 0; index < depth; index += 1) {
            chain = chain.then(() => undefined);
          }
          void chain.then(() => {
            nested = settled_(run.ordinary('nested', async () => {
              await second.opened;
              return supervisor.current().environment;
            }));
          });
          return 'slow done';
        });
        return Promise.all([slow, run.ordinary('failing', () => { throw new Error('sibling failed'); })]);
      }).finally(() => {
        events.push('run:settled');
      }));
      await settleTicks();
      first.open();
      await settleTicks();
      second.open();
      const result = await running;
      expect(result.error instanceof Error ? result.error.message : '').toBe('sibling failed');
      const outcome = nested === undefined ? { error: new Error('never called') } : await nested;
      classes.push(`${String(depth)}:${boundaryClass(events, 'nested', outcome)}`);
    }
    expect(classes.filter((entry) => entry.endsWith('accepted-but-unaccounted'))).toEqual([]);
  });
});

/** Settle a promise into a value or error, so a test can inspect a rejection it expects. */
function settled_<T>(promise: Promise<T>): Promise<{ readonly value?: T; readonly error?: unknown }> {
  return promise.then((value: T) => ({ value }), (error: unknown) => ({ error }));
}


/** CLI-005's first owner path uses a real rollback-journal artifact and a deliberately inert body. */
describe('exact execution observation preparation (A-21a/b/c)', () => {
  test.each(['delete', 'wal'] as const)('an existing foreign %s SQLite artifact remains byte-for-byte unchanged', async (journalMode) => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const location = join(directory, 'foreign.sqlite');
      const foreign = host.sqlite.openSqlite(location, { journalMode });
      foreign.exec("CREATE TABLE foreign_marker (value TEXT NOT NULL); INSERT INTO foreign_marker (value) VALUES ('retained')");
      foreign.close();
      const original = readFileSync(location);
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      let factories = 0;
      const { options } = runOptions({ resolution: () => { factories += 1; throw new Error('foreign artifact must not start Resolution'); } });
      let bodies = 0;
      const observed = supervisor.startObserved({ ...options, observationLocation: location }, () => { bodies += 1; return 'ran'; });
      await expect(observed.result).rejects.toThrow();
      expect(await observed.acknowledgment).toEqual({ kind: 'unprepared' });
      expect(factories).toBe(0);
      expect(bodies).toBe(0);
      expect(readFileSync(location)).toEqual(original);
      if (journalMode === 'delete') {
        const reader = host.reader.openSqliteReader(location);
        expect(reader.prepare('SELECT value FROM foreign_marker').get()).toEqual({ value: 'retained' });
        expect(reader.prepare("SELECT name FROM sqlite_master WHERE name = 'microdelta_execution_observation'").get()).toBeUndefined();
        reader.close();
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test.each([
    ['runId', { runId: 'r'.repeat(257) }],
    ['analysis', { analysis: 'a'.repeat(257) }],
    ['environment', { environment: 'e'.repeat(257) }],
  ] as const)('oversized %s cannot create an unreadable prepared artifact or start analysis', async (_field, override) => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      let factories = 0;
      let bodies = 0;
      const { options } = runOptions({ ...override, resolution: () => { factories += 1; throw new Error('factory must not run'); } });
      const location = join(directory, 'oversized.sqlite');
      const observed = supervisor.startObserved({ ...options, observationLocation: location }, () => { bodies += 1; return 1; });
      await expect(observed.result).rejects.toThrow();
      expect(await observed.acknowledgment).toEqual({ kind: 'unprepared' });
      expect(factories).toBe(0);
      expect(bodies).toBe(0);
      expect(existsSync(location)).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('an exact maximum context name is readable and an oversized locator grants no preparation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions({ runId: 'r'.repeat(256) });
      const valid = supervisor.startObserved({ ...options, observationLocation: join(directory, 'maximum.sqlite') }, () => 'accepted');
      expect((await valid.result).value).toBe('accepted');
      const reader = openExecutionObservationReader(host.reader, valid.locator);
      expect(reader.read()).toMatchObject({ result: { kind: 'observed', observation: { context: { runId: 'r'.repeat(256) } } } });
      reader.close();
      let factories = 0;
      const invalid = supervisor.startObserved({ ...options, resolution: () => { factories += 1; throw new Error('not reached'); }, observationLocation: 'x'.repeat(4097) }, () => 'not reached');
      await expect(invalid.result).rejects.toThrow();
      expect(await invalid.acknowledgment).toEqual({ kind: 'unprepared' });
      expect(factories).toBe(0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('a failed initial publication starts neither Resolution nor the body and reports unprepared separately', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      let factories = 0;
      let bodies = 0;
      const supervisor = createSupervision({
        context: nodeScopes,
        observation: {
          sqlite: { openSqlite: () => { throw new Error('initial store unavailable'); } },
          reader: createNodeSqliteReader(),
          random: createNodeRandom(),
          clock: createNodeClock(),
          elapsedClock: createNodeElapsedClock(),
          timer: createNodeTimer(),
        },
      });
      const { options } = runOptions({ resolution: () => { factories += 1; throw new Error('factory must not run'); } });
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'first.sqlite') }, () => {
        bodies += 1;
        return 'impossible';
      });
      await expect(observed.result).rejects.toThrow('initial store unavailable');
      expect(await observed.acknowledgment).toEqual({ kind: 'unprepared' });
      expect(factories).toBe(0);
      expect(bodies).toBe(0);
      expect(observed.locator.executionId).toMatch(/^[0-9a-f]{32}$/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('prepared is readable before entry, and no-event return closes without confirming an application result', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = {
        sqlite: createNodeSqlite(),
        reader: createNodeSqliteReader(),
        random: createNodeRandom(),
        clock: createNodeClock(),
        elapsedClock: createNodeElapsedClock(),
        timer: createNodeTimer(),
      };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions({ runId: 'weekly' });
      const location = join(directory, 'first.sqlite');
      const observed = supervisor.startObserved({ ...options, observationLocation: location }, () => {
        const reader = openExecutionObservationReader(host.reader, observed.locator);
        const atEntry = reader.read();
        reader.close();
        expect(atEntry.result.kind).toBe('observed');
        if (atEntry.result.kind === 'observed') {
          expect(atEntry.result.observation.phase).toBe('prepared');
          expect(atEntry.result.observation.revision).toBe(1);
        }
        return { filename: 'report.json' };
      });
      const result = await observed.result;
      expect(result.value).toEqual({ filename: 'report.json' });
      expect(await observed.acknowledgment).toEqual({ kind: 'acknowledged', revision: 2 });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const final = reader.read();
      expect(final.version).toBe(1);
      expect(final.result.kind).toBe('observed');
      if (final.result.kind === 'observed') {
        expect(final.result.observation).toMatchObject({ phase: 'closed', body: 'returned', application: { kind: 'not-classified' }, revision: 2, context: { analysis: 'analysis:test', environment: 'env:test', runId: 'weekly' } });
        expect(JSON.stringify(final)).not.toContain('report.json');
      }
      reader.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

/** A-21f observes the same exact artifact from independent, short-lived processes. */
describe('separate-process exact observation (A-21f/h)', () => {
  test('fresh processes read coherent active and closed revisions without affecting the run', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let entered: () => void = () => undefined;
      const began = new Promise<void>((resolve) => { entered = resolve; });
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'live.sqlite') }, async () => {
        entered();
        await gate;
        return 'body value';
      });
      await began;
      const active = readInFreshProcess(observed.locator);
      expect(active).toMatchObject({ version: 1, result: { kind: 'observed', observation: { phase: 'prepared', revision: 1 } } });
      release();
      expect((await observed.result).value).toBe('body value');
      expect(await observed.acknowledgment).toEqual({ kind: 'acknowledged', revision: 2 });
      const closed = readInFreshProcess(observed.locator);
      expect(closed).toMatchObject({ version: 1, result: { kind: 'observed', observation: { phase: 'closed', revision: 2, body: 'returned' } } });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('a process killed inside its body leaves prepared evidence without inventing closure', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const location = join(directory, 'interrupted.sqlite');
      const locatorFile = join(directory, 'locator.json');
      const source = `import { AsyncLocalStorage } from 'node:async_hooks';
import { writeFileSync } from 'node:fs';
import { createNodeClock, createNodeElapsedClock, createNodeRandom, createNodeSqlite, createNodeSqliteReader, createNodeTimer } from '@microdelta/machine-node';
import { createSupervision } from ${JSON.stringify(new URL('../src/index.js', import.meta.url).href)};
const supervisor = createSupervision({ context: { createAsyncContext: () => new AsyncLocalStorage() }, observation: { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() } });
const observed = supervisor.startObserved({ analysis: 'analysis:test', environment: 'env:test', runId: 'weekly', resolution: () => ({}), writer: { tryLease: () => ({ kind: 'unavailable' }), release: () => {} }, observationLocation: process.argv[1] }, () => { writeFileSync(process.argv[2], JSON.stringify(observed.locator)); process.kill(process.pid, 'SIGKILL'); });
await observed.result;`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', source, location, locatorFile], { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000 });
      expect(child.signal).toBe('SIGKILL');
      const locator = JSON.parse(readFileSync(locatorFile, 'utf8')) as { readonly location: string; readonly executionId: string };
      expect(readInFreshProcess(locator)).toMatchObject({ version: 1, result: { kind: 'observed', observation: { phase: 'prepared', revision: 1, context: { runId: 'weekly' } } } });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

/** These cases protect the exact-identity and body/closure distinctions of CLI-005. */
describe('observed execution identity and closure (A-21a/b/c/g)', () => {
  test('two starts competing for one new artifact grant exactly one owner', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions();
      const location = join(directory, 'contended.sqlite');
      let bodies = 0;
      const first = supervisor.startObserved({ ...options, observationLocation: location }, () => { bodies += 1; return 'first'; });
      const second = supervisor.startObserved({ ...options, observationLocation: location }, () => { bodies += 1; return 'second'; });
      const outcomes = await Promise.allSettled([first.result, second.result]);
      expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'rejected']);
      expect(bodies).toBe(1);
      expect(await first.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      expect(await second.acknowledgment).toEqual({ kind: 'unprepared' });
      const reader = openExecutionObservationReader(host.reader, first.locator);
      expect(reader.read()).toMatchObject({ result: { kind: 'observed', observation: { phase: 'closed', body: 'returned' } } });
      reader.close();
      const wrong = openExecutionObservationReader(host.reader, second.locator);
      expect(wrong.read().result.kind).toBe('identity-mismatch');
      wrong.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('reusing public runId still mints distinct exact identities, and a path collision preserves its first record', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions({ runId: 'weekly' });
      const first = supervisor.startObserved({ ...options, observationLocation: join(directory, 'one.sqlite') }, () => 1);
      expect((await first.result).value).toBe(1);
      expect(await first.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      const second = supervisor.startObserved({ ...options, observationLocation: join(directory, 'two.sqlite') }, () => 2);
      expect((await second.result).value).toBe(2);
      expect(first.locator.executionId).not.toBe(second.locator.executionId);
      const firstReader = openExecutionObservationReader(host.reader, first.locator);
      const firstDocument = firstReader.read();
      expect(firstDocument.result.kind).toBe('observed');
      const collided = supervisor.startObserved({ ...options, observationLocation: first.locator.location }, () => 3);
      const disposition = await collided.result.then(() => 'resolved', () => 'rejected');
      expect({ disposition, first: firstDocument.result.kind, after: firstReader.read().result.kind }).toEqual({ disposition: 'rejected', first: 'observed', after: 'observed' });
      expect(await collided.acknowledgment).toEqual({ kind: 'unprepared' });
      expect(firstReader.read()).toEqual(firstDocument);
      firstReader.close();
      const wrong = openExecutionObservationReader(host.reader, { location: first.locator.location, executionId: second.locator.executionId });
      expect(wrong.read().result.kind).toBe('identity-mismatch');
      wrong.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('a post-prepared setup failure closes as not-entered without calling the body', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const failure = new Error('resolution setup failed');
      let bodies = 0;
      const { options } = runOptions({ resolution: () => { throw failure; } });
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'setup.sqlite') }, () => { bodies += 1; return 1; });
      await expect(observed.result).rejects.toBe(failure);
      expect(bodies).toBe(0);
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const document = reader.read();
      expect(document.result.kind).toBe('observed');
      if (document.result.kind === 'observed') {
        expect(document.result.observation).toMatchObject({ phase: 'closed', body: 'not-entered', application: { kind: 'not-classified' } });
      }
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('a setup writer-release failure is a bounded diagnostic beside the original setup rejection', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const failure = new Error('original setup error');
      const writer = recordingWriter({ releaseThrows: true });
      let bodies = 0;
      const { options } = runOptions({ writer: writer.writer, resolution: () => { throw failure; } });
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'setup-release.sqlite') }, () => { bodies += 1; return 1; });
      await expect(observed.result).rejects.toBe(failure);
      expect(bodies).toBe(0);
      expect(writer.releases.count).toBe(1);
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const document = reader.read();
      expect(document).toMatchObject({ result: { kind: 'observed', observation: { body: 'not-entered', diagnostics: { present: true, count: 1, lowerBound: false } } } });
      expect(JSON.stringify(document)).not.toContain('storage closed underneath the run');
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('partial setup drains a tracked send and retains observer and unsubscribe diagnostics', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const failure = new Error('setup failed after tracked work began');
      const controller = createStopController();
      let unsubscribes = 0;
      const stop = Object.freeze({
        get state() { return controller.state; },
        signal: controller.signal,
        request: controller.request,
        subscribe(listener: Parameters<typeof controller.subscribe>[0]) {
          const remove = controller.subscribe(listener);
          return (): void => { remove(); unsubscribes += 1; throw new Error('private unsubscribe detail'); };
        },
      });
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let enter: () => void = () => undefined;
      const began = new Promise<void>((resolve) => { enter = resolve; });
      let bodies = 0;
      const { options } = runOptions({ stop, observers: [{ observe(event) {
        if (event.kind === 'send' && event.phase === 'end') { throw new Error('private observer detail'); }
      } }], resolution: (ports) => {
        void ports.execution.execute(step, async () => supervisor.execution().send({
          label: 'setup-send',
          perform: async () => { enter(); await gate; return 'sent'; },
        }));
        throw failure;
      } });
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'partial-setup.sqlite') }, () => { bodies += 1; return 1; });
      await began;
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      expect(reader.read()).toMatchObject({ result: { kind: 'observed', observation: { phase: 'prepared', revision: 1 } } });
      let finished = false;
      void observed.result.finally(() => { finished = true; }).catch(() => undefined);
      await Promise.resolve();
      expect(finished).toBe(false);
      release();
      await expect(observed.result).rejects.toBe(failure);
      expect(bodies).toBe(0);
      expect(unsubscribes).toBe(1);
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      const document = reader.read();
      expect(document).toMatchObject({ result: { kind: 'observed', observation: { phase: 'closed', body: 'not-entered', eventCounts: { send: 2 }, diagnostics: { present: true, count: 2, lowerBound: false } } } });
      expect(JSON.stringify(document)).not.toContain('private unsubscribe detail');
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('a no-event body throw is recorded as threw while preserving the original rejection', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const failure = new Error('application failed');
      const { options } = runOptions();
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'threw.sqlite') }, () => { throw failure; });
      await expect(observed.result).rejects.toBe(failure);
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const document = reader.read();
      expect(document.result.kind).toBe('observed');
      if (document.result.kind === 'observed') {
        expect(document.result.observation).toMatchObject({ phase: 'closed', body: 'threw', application: { kind: 'not-classified' } });
      }
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('an early application statement cannot close tracked ordinary work, and conflicting or late statements fail', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let entered: () => void = () => undefined;
      const began = new Promise<void>((resolve) => { entered = resolve; });
      let submission: { submit(statement: { kind: 'confirmed'; deliverable: string }): void } | undefined;
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'held.sqlite') }, (run, app) => {
        submission = app;
        void run.ordinary('held', async () => { entered(); await gate; });
        app.submit({ kind: 'confirmed', deliverable: 'report:one' });
        app.submit({ kind: 'confirmed', deliverable: 'report:one' });
        expect(() => app.submit({ kind: 'confirmed', deliverable: 'report:two' })).toThrow();
        return 'body returned';
      });
      await began;
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const during = reader.read();
      expect(during.result.kind).toBe('observed');
      if (during.result.kind === 'observed') { expect(during.result.observation.phase).not.toBe('closed'); }
      release();
      expect((await observed.result).value).toBe('body returned');
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      const after = reader.read();
      expect(after.result.kind).toBe('observed');
      if (after.result.kind === 'observed') { expect(after.result.observation).toMatchObject({ phase: 'closed', application: { kind: 'confirmed', deliverable: 'report:one' } }); }
      expect(() => submission?.submit({ kind: 'confirmed', deliverable: 'report:one' })).toThrow();
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('a confirmed statement needs a bounded deliverable locator and mutable incomplete reasons are copied canonically', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions();
      const reasons: ('required-work' | 'coverage' | 'publication' | 'other')[] = ['publication', 'coverage', 'publication'];
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'statement.sqlite') }, (_run, application) => {
        for (const forged of [
          { kind: 'confirmed', deliverable: '' },
          { kind: 'confirmed', deliverable: 'x'.repeat(257) },
          { kind: 'incomplete', reasons: [] },
          { kind: 'incomplete', reasons: ['private-reason'] },
          { kind: 'secret-outcome', authorPayload: 'private-content' },
        ]) {
          expect((): void => { Reflect.apply(application.submit, application, [forged]); }).toThrow(TypeError);
        }
        application.submit({ kind: 'incomplete', reasons });
        reasons.push('other');
        application.submit({ kind: 'incomplete', reasons: ['coverage', 'publication'] });
        return 'body returned';
      });
      expect((await observed.result).value).toBe('body returned');
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const document = reader.read();
      expect(document).toMatchObject({ result: { kind: 'observed', observation: { body: 'returned', application: { kind: 'incomplete', reasons: ['coverage', 'publication'] } } } });
      expect(JSON.stringify(document)).not.toContain('private-content');
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('a confirmed assertion survives a later unrelated body error without claiming success', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions();
      const failure = new Error('unrelated callback failure private details');
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'confirmed-then-error.sqlite') }, (_run, application) => {
        application.submit({ kind: 'confirmed', deliverable: 'report:sealed' });
        throw failure;
      });
      await expect(observed.result).rejects.toBe(failure);
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const document = reader.read();
      expect(document).toMatchObject({ result: { kind: 'observed', observation: { phase: 'closed', body: 'threw', application: { kind: 'confirmed', deliverable: 'report:sealed' }, executionFailure: { kind: 'other' } } } });
      expect(JSON.stringify(document)).not.toContain('private details');
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

/** Controlled elapsed and wall readings separate pacing from displayed sample time. */
describe('bounded observed event sampling (A-21d/e)', () => {
  test('observation fault count reports exact maximum and a lower bound after attempted overflow', () => {
    const before = { count: Number.MAX_SAFE_INTEGER - 1, lowerBound: false };
    const exactMaximum = _incrementObservationFaults(before);
    expect(exactMaximum).toEqual({ count: Number.MAX_SAFE_INTEGER, lowerBound: false });
    expect(_incrementObservationFaults(exactMaximum)).toEqual({ count: Number.MAX_SAFE_INTEGER, lowerBound: true });
    expect(before.count).toBe(Number.MAX_SAFE_INTEGER - 1);
  });

  test('an event counter saturates at the safe-integer boundary and marks later values as lower bounds', () => {
    const before: IExecutionObservationEventCounts = { step: Number.MAX_SAFE_INTEGER - 1, ordinary: 2, operation: 0, send: 0, wait: 0, promotion: 0, stop: 0, lowerBound: false };
    const exactMaximum = _incrementObservationEventCounts(before, 'step');
    expect(exactMaximum).toEqual({ ...before, step: Number.MAX_SAFE_INTEGER });
    const saturated = _incrementObservationEventCounts(exactMaximum, 'step');
    expect(saturated).toEqual({ ...before, step: Number.MAX_SAFE_INTEGER, lowerBound: true });
    expect(_incrementObservationEventCounts(saturated, 'ordinary')).toEqual({ ...saturated, ordinary: 3 });
    expect(before.step).toBe(Number.MAX_SAFE_INTEGER - 1);
  });

  test('high-volume step, ordinary, send, promotion and stop routes retain only exact bounded counts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const controller = createStopController();
      const events: IRunEvent[] = [];
      const supervisor = createSupervision({ context: nodeScopes, timer: host.timer, observation: host });
      const { options } = runOptions({
        stop: controller,
        observers: [{ observe: (event) => { events.push(event); } }],
        promotion: {
          promoteResults(_lease, request) { return { promotionId: 1, target: request.target, references: request.references, evidence: request.evidence, fence: 1 }; },
          readPromotions: () => [],
        },
      });
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'mixed.sqlite') }, async (run) => {
        await run.resolve(step, { requestKey: 'request:one' });
        for (let index = 0; index < 200; index += 1) { await run.ordinary('secret-ordinary-label', () => index); }
        await supervisor.execution().send({ label: 'secret-send-label', perform: async () => 'sent' });
        await run.promote({ into: 'env:production', references: [], evidence: { format: 'test', formatVersion: 1, content: 'secret-evidence' } });
        controller.request({ level: 'soft' });
        return 'finished';
      });
      expect((await observed.result).value).toBe('finished');
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const document = reader.read();
      expect(document.result.kind).toBe('observed');
      if (document.result.kind === 'observed') {
        expect(document.result.observation.eventCounts).toEqual({ step: 5, ordinary: 400, operation: 0, send: 2, wait: 0, promotion: 1, stop: 1, lowerBound: false });
      }
      expect(events.map((event) => event.kind).filter((kind) => kind === 'step')).toHaveLength(5);
      expect(events.map((event) => event.kind).filter((kind) => kind === 'ordinary')).toHaveLength(400);
      expect(JSON.stringify(document)).not.toMatch(/secret-|secret-evidence/u);
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('many ordinary events coalesce to one newest pending revision and terminal supersedes it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      let wall = 1000;
      let elapsed = 0;
      let observationUpdates = 0;
      const scheduled: { at: number; callback: () => void; cancelled: boolean }[] = [];
      const clock = { currentEpochMilliseconds: () => wall };
      const real = createNodeSqlite();
      const sqlite = {
        openSqlite(location: string, configuration?: { journalMode: 'wal' | 'delete'; creation?: 'exclusive' }) {
          const connection = real.openSqlite(location, configuration);
          return {
            ...connection,
            prepare(sql: string) {
              const statement = connection.prepare(sql);
              if (!sql.startsWith('UPDATE microdelta_execution_observation')) { return statement; }
              return { ...statement, run: (...values: readonly (string | number | null | Uint8Array)[]) => {
                observationUpdates += 1;
                return statement.run(...values);
              } };
            },
          };
        },
      };
      const timer = {
        currentEpochMilliseconds: () => wall,
        schedule(at: number, callback: () => void): () => void {
          const slot = { at, callback, cancelled: false };
          scheduled.push(slot);
          return () => { slot.cancelled = true; };
        },
      };
      const host = { sqlite, reader: createNodeSqliteReader(), random: createNodeRandom(), clock, elapsedClock: { currentElapsedMilliseconds: () => elapsed }, timer };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let entered: () => void = () => undefined;
      const began = new Promise<void>((resolve) => { entered = resolve; });
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'events.sqlite') }, async (run) => {
        for (let count = 0; count < 5; count += 1) { await run.ordinary('secret-member-label', () => count); }
        entered();
        await gate;
        return 'done';
      });
      await began;
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const before = reader.read();
      expect(before.result.kind).toBe('observed');
      if (before.result.kind === 'observed') { expect(before.result.observation.revision).toBe(1); }
      expect(scheduled.length).toBe(1);
      const early = scheduled[0];
      expect(early).toBeDefined();
      wall = 100;
      elapsed = 500;
      early?.callback();
      if (early !== undefined) { early.cancelled = true; }
      expect(observationUpdates).toBe(0);
      expect(reader.read()).toEqual(before);
      expect(scheduled.filter((slot) => !slot.cancelled)).toHaveLength(1);
      wall = 10_000;
      elapsed = 1000;
      for (const slot of scheduled.filter((candidate) => !candidate.cancelled && candidate.at <= wall)) { slot.callback(); }
      expect(observationUpdates).toBe(1);
      await Promise.resolve();
      const sampled = reader.read();
      expect(sampled.result.kind).toBe('observed');
      if (sampled.result.kind === 'observed') {
        expect(sampled.result.observation.revision).toBe(2);
        expect(sampled.result.observation.eventCounts.ordinary).toBe(10);
      }
      expect(JSON.stringify(sampled)).not.toContain('secret-member-label');
      release();
      expect((await observed.result).value).toBe('done');
      const final = reader.read();
      expect(final.result.kind).toBe('observed');
      if (final.result.kind === 'observed') {
        expect(final.result.observation).toMatchObject({ phase: 'closed', revision: 3, eventCounts: { ordinary: 10 } });
      }
      expect(observationUpdates).toBe(2);
      for (const slot of scheduled) { slot.callback(); }
      expect(observationUpdates).toBe(2);
      expect(reader.read()).toEqual(final);
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

/** Observation faults must remain a separate finite fact after a successful run. */
describe('observation acknowledgment and containment (A-21e/h)', () => {
  test('a publish-position observation fault cannot change Resolution or writer outcomes', async () => {
    /** A committed publish event is observed privately before user observer diagnostics. */
    async function scenario(faulted: boolean) {
      const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
      try {
        const real = createNodeSqlite();
        let failedWrites = 0;
        const sqlite = {
          openSqlite(location: string, configuration?: { journalMode: 'wal' | 'delete'; creation?: 'exclusive' }) {
            const connection = real.openSqlite(location, configuration);
            return { ...connection, prepare(sql: string) {
              const statement = connection.prepare(sql);
              if (!sql.startsWith('UPDATE microdelta_execution_observation')) { return statement; }
              return { ...statement, run: (...values: readonly (string | number | null | Uint8Array)[]) => {
                if (faulted && failedWrites === 0) { failedWrites += 1; throw new Error('observation write failed at publish'); }
                return statement.run(...values);
              } };
            } };
          },
        };
        let elapsed = 0;
        let callback: (() => void) | undefined;
        const host = {
          sqlite, reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(),
          elapsedClock: { currentElapsedMilliseconds: () => elapsed },
          timer: { currentEpochMilliseconds: () => Date.now(), schedule(_at: number, next: () => void) { callback = next; return () => { callback = undefined; }; } },
        };
        const supervisor = createSupervision({ context: nodeScopes, observation: host });
        const events: IRunEvent[] = [];
        let publishCallbacks = 0;
        const { options, double, writer } = runOptions({ observers: [{ observe(event) {
          events.push(event);
          if (event.kind === 'step' && event.event.phase === 'publish') {
            publishCallbacks += 1;
            elapsed = 1000;
            callback?.();
            if (faulted) { throw new Error('user publish observer failed'); }
          }
        } }] });
        const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'publish.sqlite') }, (run) => run.resolve(step, { requestKey: 'request:one' }));
        const result = await observed.result;
        const receipt = await observed.acknowledgment;
        const reader = openExecutionObservationReader(host.reader, observed.locator);
        const document = reader.read();
        reader.close();
        return {
          policy: { kind: result.value.kind, decisions: double.decisions, calls: double.calls, releases: writer.releases.count },
          receipt, document, failedWrites, publishCallbacks, steps: events.filter((event) => event.kind === 'step').length,
        };
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
    const control = await scenario(false);
    const faulted = await scenario(true);
    expect(control.policy).toEqual(faulted.policy);
    expect(control.policy.kind).toBe('published');
    expect(control.publishCallbacks).toBe(1);
    expect(faulted.publishCallbacks).toBe(1);
    expect(faulted.failedWrites).toBe(1);
    expect(control.receipt).toMatchObject({ kind: 'acknowledged' });
    expect(faulted.receipt).toMatchObject({ kind: 'acknowledged', observationFaults: { count: 1, lowerBound: false } });
    expect(faulted.document).toMatchObject({ result: { kind: 'observed', observation: { phase: 'closed', eventCounts: { step: faulted.steps }, diagnostics: { present: true }, observationFaults: { count: 1, lowerBound: false } } } });
  });

  test('a hard stop aborts an active send synchronously without flushing observation SQL', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      let updates = 0;
      let timerFaults = 0;
      const real = createNodeSqlite();
      const sqlite = {
        openSqlite(location: string, configuration?: { journalMode: 'wal' | 'delete'; creation?: 'exclusive' }) {
          const connection = real.openSqlite(location, configuration);
          return { ...connection, prepare(sql: string) {
            const statement = connection.prepare(sql);
            if (!sql.startsWith('UPDATE microdelta_execution_observation')) { return statement; }
            return { ...statement, run: (...values: readonly (string | number | null | Uint8Array)[]) => { updates += 1; return statement.run(...values); } };
          } };
        },
      };
      const realTimer = createNodeTimer();
      const observationTimer = {
        ...realTimer,
        schedule(at: number, callback: () => void) {
          if (timerFaults === 0) { timerFaults += 1; throw new Error('observation timer unavailable'); }
          return realTimer.schedule(at, callback);
        },
      };
      const host = { sqlite, reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: observationTimer };
      const controller = createStopController();
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      let entered: () => void = () => undefined;
      const began = new Promise<void>((resolve) => { entered = resolve; });
      let aborted = false;
      let sent = 0;
      const { options } = runOptions({ stop: controller, observers: [{ observe(event) { if (event.kind === 'stop') { throw new Error('user observer failed'); } } }] });
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'stop-no-flush.sqlite') }, async () => {
        return supervisor.execution().send({
          label: 'active-send',
          perform(signal) { sent += 1; return new Promise<string>((_resolve, reject) => { signal.onAbort(() => { aborted = true; reject(new Error('aborted provider')); }); entered(); }); },
          cancel: async () => 'cancelled',
        }).then(() => 'unexpected', (error: unknown) => error instanceof SupervisionError ? error.code : 'other');
      });
      await began;
      const before = updates;
      controller.request({ level: 'hard' });
      expect(aborted).toBe(true);
      expect(updates).toBe(before);
      expect(sent).toBe(1);
      expect((await observed.result).value).toBe('stopped');
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged', observationFaults: { count: 1, lowerBound: false } });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const document = reader.read();
      expect(document).toMatchObject({ result: { kind: 'observed', observation: { stop: { level: 'hard' }, eventCounts: { stop: 1 }, diagnostics: { present: true, count: 1 }, observationFaults: { count: 1, lowerBound: false } } } });
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('a lost terminal write acknowledgment preserves the body outcome and exact sealed contents for readback', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const real = createNodeSqlite();
      let committed = 0;
      const sqlite = {
        openSqlite(location: string, configuration?: { journalMode: 'wal' | 'delete' }) {
          const connection = real.openSqlite(location, configuration);
          return {
            ...connection,
            prepare(sql: string) {
              const statement = connection.prepare(sql);
              if (!sql.startsWith('UPDATE microdelta_execution_observation')) { return statement; }
              return { ...statement, run: (...values: readonly (string | number | null | Uint8Array)[]) => {
                statement.run(...values);
                committed += 1;
                throw new Error('terminal acknowledgment lost');
              } };
            },
          };
        },
      };
      const host = { sqlite, reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions();
      let bodies = 0;
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'lost.sqlite') }, (_run, app) => {
        bodies += 1;
        app.submit({ kind: 'confirmed', deliverable: 'report:exact' });
        return 'kept result';
      });
      expect((await observed.result).value).toBe('kept result');
      expect(await observed.acknowledgment).toEqual({ kind: 'uncertain' });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const first = reader.read();
      expect(first).toMatchObject({ version: 1, result: { kind: 'observed', observation: { revision: 2, phase: 'closed', body: 'returned', application: { kind: 'confirmed', deliverable: 'report:exact' } } } });
      expect(reader.read()).toEqual(first);
      expect(committed).toBe(1);
      expect(bodies).toBe(1);
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('validation failure settles an unprepared receipt without calling any analysis factory', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      let factories = 0;
      const { options } = runOptions({ environment: '', resolution: () => { factories += 1; throw new Error('must not run'); } });
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'invalid.sqlite') }, () => 1);
      await expect(observed.result).rejects.toThrow();
      const acknowledgment = await Promise.race([observed.acknowledgment, new Promise<'still-pending'>((resolve) => setTimeout(() => resolve('still-pending'), 50))]);
      expect(acknowledgment).toEqual({ kind: 'unprepared' });
      expect(factories).toBe(0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('an ordinary storage fault remains visible when the terminal commit later succeeds', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      let wall = 1000;
      let elapsed = 0;
      let failNextUpdate = true;
      const scheduled: { at: number; callback: () => void; cancelled: boolean }[] = [];
      const real = createNodeSqlite();
      const sqlite = {
        openSqlite(location: string, configuration?: { journalMode: 'wal' | 'delete' }) {
          const connection = real.openSqlite(location, configuration);
          return {
            ...connection,
            prepare(sql: string) {
              const statement = connection.prepare(sql);
              if (!sql.startsWith('UPDATE microdelta_execution_observation')) { return statement; }
              return { ...statement, run: (...values: readonly (string | number | null | Uint8Array)[]) => {
                if (failNextUpdate) { failNextUpdate = false; throw new Error('one observation write failed'); }
                return statement.run(...values);
              } };
            },
          };
        },
      };
      const timer = {
        currentEpochMilliseconds: () => wall,
        schedule(at: number, callback: () => void): () => void {
          const slot = { at, callback, cancelled: false };
          scheduled.push(slot);
          return () => { slot.cancelled = true; };
        },
      };
      const host = { sqlite, reader: createNodeSqliteReader(), random: createNodeRandom(), clock: { currentEpochMilliseconds: () => wall }, elapsedClock: { currentElapsedMilliseconds: () => elapsed }, timer };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let entered: () => void = () => undefined;
      const began = new Promise<void>((resolve) => { entered = resolve; });
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'fault.sqlite') }, async (run) => {
        await run.ordinary('work', () => 1);
        entered();
        await gate;
        return 'original value';
      });
      await began;
      wall = 2000;
      elapsed = 1000;
      for (const slot of scheduled.filter((candidate) => !candidate.cancelled && candidate.at <= wall)) { slot.callback(); }
      release();
      expect((await observed.result).value).toBe('original value');
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged', observationFaults: { count: 1, lowerBound: false } });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const terminal = reader.read();
      expect(terminal.result.kind).toBe('observed');
      if (terminal.result.kind === 'observed') { expect(terminal.result.observation).toMatchObject({ phase: 'closed', observationFaults: { count: 1, lowerBound: false } }); }
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('terminal clock failure cannot replace an original body value or rejection and settles uncertain', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      let clockFails = false;
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: { currentEpochMilliseconds: () => { if (clockFails) { throw new Error('terminal clock failed'); } return 1000; } }, elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions();
      const successful = supervisor.startObserved({ ...options, observationLocation: join(directory, 'return.sqlite') }, () => { clockFails = true; return 'kept'; });
      expect((await successful.result).value).toBe('kept');
      expect(await successful.acknowledgment).toEqual({ kind: 'uncertain' });
      clockFails = false;
      const failure = new Error('body failed');
      const rejected = supervisor.startObserved({ ...options, observationLocation: join(directory, 'throw.sqlite') }, () => { clockFails = true; throw failure; });
      await expect(rejected.result).rejects.toBe(failure);
      expect(await rejected.acknowledgment).toEqual({ kind: 'uncertain' });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

/** Loss of the prepared-write acknowledgment cannot authorize body entry. */
describe('initial observation commit uncertainty (A-21a/h)', () => {
  test('a committed prepared row followed by a lost acknowledgment starts zero analysis and promises no terminal', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const real = createNodeSqlite();
      const host = {
        sqlite: {
          openSqlite(location: string, configuration?: { journalMode: 'wal' | 'delete' }) {
            const connection = real.openSqlite(location, configuration);
            return {
              ...connection,
              prepare(sql: string) {
                const statement = connection.prepare(sql);
                if (!sql.startsWith('INSERT INTO microdelta_execution_observation')) { return statement; }
                return { ...statement, run: (...values: readonly (string | number | null | Uint8Array)[]) => {
                  statement.run(...values);
                  throw new Error('prepared acknowledgment lost');
                } };
              },
            };
          },
        },
        reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer(),
      };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      let factories = 0;
      let bodies = 0;
      const { options } = runOptions({ resolution: () => { factories += 1; throw new Error('factory must not run'); } });
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'prepared.sqlite') }, () => { bodies += 1; return 1; });
      await expect(observed.result).rejects.toThrow('prepared acknowledgment lost');
      expect(await observed.acknowledgment).toEqual({ kind: 'unprepared' });
      expect(factories).toBe(0);
      expect(bodies).toBe(0);
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const document = reader.read();
      expect(document.result.kind).toBe('observed');
      if (document.result.kind === 'observed') { expect(document.result.observation).toMatchObject({ phase: 'prepared', revision: 1 }); }
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

/** Terminal facts come from the closing run, not from later mutable controls. */
describe('authoritative terminal execution facts (A-21c)', () => {
  test('an untyped foreign SupervisionError code stays an other failure without corrupting the artifact', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions();
      // Untyped consumers can construct a real class instance with a code outside the closed declaration union.
      const failure: unknown = Reflect.construct(SupervisionError, ['PRIVATE_PROVIDER_CODE', 'private provider detail']);
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'foreign-code.sqlite') }, () => { throw failure; });
      await expect(observed.result).rejects.toBe(failure);
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const document = reader.read();
      expect(document).toMatchObject({ result: { kind: 'observed', observation: { phase: 'closed', body: 'threw', executionFailure: { kind: 'other' } } } });
      expect(JSON.stringify(document)).not.toContain('PRIVATE_PROVIDER_CODE');
      expect(JSON.stringify(document)).not.toContain('private provider detail');
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test.each([
    ['cancelled', async (): Promise<'cancelled' | 'running'> => 'cancelled', 'cancelled'],
    ['running', async (): Promise<'cancelled' | 'running'> => 'running', 'running'],
    ['unknown', async (): Promise<'cancelled' | 'running'> => Promise.reject(new Error('private provider failure')), 'unknown'],
  ] as const)('hard stop records only the %s remote-state count and frozen stop', async (_label, cancel, remote) => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const controller = createStopController();
      const supervisor = createSupervision({ context: nodeScopes, timer: host.timer, observation: host });
      const events: IRunEvent[] = [];
      const { options } = runOptions({ stop: controller, observers: [{ observe: (event) => { events.push(event); } }] });
      let enter: () => void = () => undefined;
      const began = new Promise<void>((resolve) => { enter = resolve; });
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, `${remote}.sqlite`) }, async () => {
        const sending = supervisor.execution().send({
          label: 'private-provider-label',
          perform(signal) {
            return new Promise<string>((_resolve, reject) => {
              signal.onAbort(() => reject(new Error('private provider rejection')));
              enter();
            });
          },
          cancel,
        });
        await began;
        controller.request({ level: 'hard' });
        return sending.then(() => 'sent', (error: unknown) => error instanceof SupervisionError ? error.code : 'other');
      });
      expect((await observed.result).value).toBe('stopped');
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      controller.request({ level: 'hard' });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const document = reader.read();
      expect(document.result.kind).toBe('observed');
      expect(events.filter((event) => event.kind === 'send').map((event) => event.kind === 'send' ? event.phase : undefined)).toEqual(['begin', 'aborted', 'cancel-requested', 'remote-state']);
      if (document.result.kind === 'observed') {
        expect(document.result.observation.stop).toMatchObject({ level: 'hard', cause: 'operator' });
        expect(document.result.observation.interruptions).toEqual({ cancelled: remote === 'cancelled' ? 1 : 0, running: remote === 'running' ? 1 : 0, unknown: remote === 'unknown' ? 1 : 0, lowerBound: false });
        expect(document.result.observation.eventCounts.send).toBe(4);
        expect(document.result.observation.eventCounts.stop).toBe(1);
      }
      expect(JSON.stringify(document)).not.toContain('private-provider-label');
      expect(JSON.stringify(document)).not.toContain('private provider rejection');
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('closing stop and bounded diagnostics are frozen independently of later controller changes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const controller = createStopController();
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions({ stop: controller, observers: [{ observe: (event) => { if (event.kind === 'ordinary' && event.phase === 'end') { throw new Error('observer diagnostic'); } } }] });
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'stop.sqlite') }, async (run) => {
        await run.ordinary('work', () => 1);
        controller.request({ level: 'soft' });
        return 'done';
      });
      expect((await observed.result).value).toBe('done');
      controller.request({ level: 'hard' });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const document = reader.read();
      expect(document.result.kind).toBe('observed');
      if (document.result.kind === 'observed') {
        expect(document.result.observation).toMatchObject({ phase: 'closed', stop: { level: 'soft', cause: 'operator' }, diagnostics: { present: true, count: 1 } });
      }
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('a thrown arbitrary body error is typed only as other and never serialized', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-observation-'));
    try {
      const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
      const supervisor = createSupervision({ context: nodeScopes, observation: host });
      const { options } = runOptions();
      const failure = new Error('secret arbitrary error payload');
      const observed = supervisor.startObserved({ ...options, observationLocation: join(directory, 'failure.sqlite') }, () => { throw failure; });
      await expect(observed.result).rejects.toBe(failure);
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      const document = reader.read();
      expect(document.result.kind).toBe('observed');
      if (document.result.kind === 'observed') { expect(document.result.observation).toMatchObject({ phase: 'closed', body: 'threw', executionFailure: { kind: 'other' } }); }
      expect(JSON.stringify(document)).not.toContain('secret arbitrary error payload');
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
