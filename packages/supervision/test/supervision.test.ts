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

import { describe, expect, test } from '@jest/globals';
import { declarations } from '@microdelta/definition';
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
  IRecoveryResult,
  IResolution,
  IResolutionOutcome,
  IResolveRequest,
} from '@microdelta/resolution';

import { SupervisionError, createSupervision, ordinaryLifecycle, stepLifecycle } from '../src/index.js';
import type {
  IFoldReport,
  IMemberOutcome,
  IResolutionPorts,
  IRun,
  IRunEvent,
  IRunLease,
  IRunObserver,
  IRunOptions,
  IRunScope,
  IRunScopeCapability,
  ISupervision,
} from '../src/index.js';

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
  readonly calls: { readonly operation: 'resolve' | 'check' | 'recover' | 'members' | 'fold'; readonly lease?: IRunLease; readonly requestKey?: string; readonly template?: string; readonly step?: string }[];
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
}

/** The fold step the double resolves, and the template step it consumes. */
const foldStep: IBindingDescriptor = Object.freeze({ scope: 'analysis:test', role: 'step', slot: 'report' });
const foldOver: IBindingDescriptor = Object.freeze({ scope: 'analysis:test', role: 'step', slot: 'summary', template: 'contributor', collection: 'contributors' });

/** Evidence fields of a fold outcome that ran no fold work. */
const noFoldWork = Object.freeze({ step: foldStep, misses: [], trace: [], diagnostics: [] });

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
        } catch (error: unknown) {
          diagnostics.push(`observer failed at publish: ${error instanceof Error ? error.message : String(error)}`);
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
      lease(): IRunLease {
        if (options.unavailable === true) {
          throw new SupervisionError('writer-unavailable', 'another holder owns the store');
        }
        const lease = Object.freeze({ holder: 'run:test', fence: leases.length + 1, expiresAt: 10_000 });
        leases.push(lease);
        return lease;
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
    const activity = source<string>({ subject: 'activity:ada', run: () => 'ada' });
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
    const activity = source<string>({ subject: 'activity:ada', run: () => 'ada' });
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

  test('an unavailable writer fails that normal request without blocking check-only or recovery', async () => {
    const supervisor = supervision();
    const { double, factory } = recordingResolution();
    const writer = recordingWriter({ unavailable: true });
    await supervisor.run({ analysis: 'analysis:test', environment: 'env:test', resolution: factory, writer: writer.writer }, async (run) => {
      await expectSupervisionError(run.resolve(step, { requestKey: 'request:1' }), 'writer-unavailable');
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
    expect(first.map((event) => event.kind === 'step' ? event.event.phase : event.kind === 'stop' ? event.level : event.phase)).toEqual(['verify', 'admit', 'claim', 'execute', 'publish']);
    expect(second).toEqual(first);
    expect(first.every((event) => Object.isFrozen(event) && event.runId === 'run:observed')).toBe(true);
  });

  test('an observer failure reaches Resolution after every observer has seen the event', async () => {
    const supervisor = supervision();
    const later: string[] = [];
    const { options } = runOptions({
      observers: [
        { observe: (event) => { if (event.kind === 'step' && event.event.phase === 'publish') { throw new Error('first observer failed'); } } },
        { observe: (event) => { if (event.kind === 'step') { later.push(event.event.phase); } } },
      ],
    });
    const result = await supervisor.run(options, (run) => run.resolve(step, { requestKey: 'request:1' }));
    expect(later).toContain('publish');
    expect(result.value).toMatchObject({ kind: 'published', reference });
    expect(result.diagnostics).toEqual([expect.stringContaining('first observer failed')]);
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
    let ran = 0;
    const { options } = runOptions({
      observers: [{ observe: (event) => { if (event.kind === 'ordinary' && event.phase === 'begin' && event.label === 'first') { throw new Error('begin failed'); } } }],
    });
    const result = await supervisor.run(options, async (run) => {
      await expectSupervisionError(run.ordinary('first', () => { ran += 1; }), 'observer-failure');
      return run.ordinary('second', () => { ran += 1; return 'second ran'; });
    });
    expect(ran).toBe(1);
    expect(result.value).toBe('second ran');
  });

  test('an observer failure after ordinary work finished is a diagnostic beside its value', async () => {
    const supervisor = supervision();
    const { options } = runOptions({
      observers: [{ observe: (event) => { if (event.kind === 'ordinary' && event.phase === 'end') { throw new Error('end failed'); } } }],
    });
    const result = await supervisor.run(options, (run) => run.ordinary('report', () => 'value'));
    expect(result.value).toBe('value');
    expect(result.diagnostics).toEqual([expect.stringContaining('end failed')]);
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
    expect(result.diagnostics).toEqual([expect.stringContaining('slow end observer failed')]);
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
      const writer = { lease: (): IRunLease => Object.freeze({ holder: 'h', fence: 1, expiresAt: 1 }), release: (): void => { events.push('writer:release'); } };
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
      const writer = { lease: (): IRunLease => Object.freeze({ holder: 'h', fence: 1, expiresAt: 1 }), release: (): void => { events.push('writer:release'); } };
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
