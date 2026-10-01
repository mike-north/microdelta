/**
 * Owner tests for operator stop intent, the run's permit pool, stop-aware
 * waits and the cancellation port Supervision hands to Resolution
 * (RUN-002, RUN-014, RUN-015, A-13, A-18; EXP-8 mechanisms 1 and 2).
 *
 * Expectations come from the owner decisions and the EXP-8 selection: a soft
 * stop admits no new work and refuses every retry while admitted steps drain,
 * with no default deadline; an operator deadline or a hard stop escalates; a
 * hard stop aborts sends, permit waits and waits for a time, discards
 * uncommitted output and records the remote state as cancelled, running or
 * unknown; the publication commit is the linearization point. Time is a fake
 * timer and provider requests are gated, so nothing depends on real delays.
 *
 * @see ../../../docs/spec/operations.md (RUN-002, RUN-014, RUN-015)
 * @see ../../../docs/spec/acceptance.md (A-13, A-18)
 * @see ../../../experiments/exp-8/decision.md (mechanisms 1 and 2, ruling R)
 */
import { describe, expect, test } from '@jest/globals';

import { createAbortSource } from '../src/control.js';
import type { IAbortSource } from '../src/control.js';
import { raceAbort, runControls } from '../src/execution.js';
import type { ISupervisedRun } from '../src/execution.js';
import { SupervisionError, createStopController, createSupervision } from '../src/index.js';
import type { IResolution } from '@microdelta/resolution';

import type { IAbortSignal, IResolutionPorts, IRunEvent, IRunExecution, IRunObserver, IRunOptions, IStopState, ISupervision } from '../src/index.js';
import { createPermitPool } from '../src/permits.js';
import { T0, admissionFor, codeOf, controlEvents, deferred, fakeTimer, hour, nodeScopes, optionsFor, portDouble, settle, stepOf, stubProvider, supervisionWith } from './support.js';

/** A state value, for readable equality. */
function state(level: IStopState['level'], cause?: IStopState['cause'], deadline?: number): IStopState {
  return { level, cause, deadline };
}

describe('stop controller (RUN-014)', () => {
  test('levels only escalate, and every change is observed in order', () => {
    const controller = createStopController();
    const seen: IStopState[] = [];
    controller.subscribe((next) => seen.push(next));
    expect(controller.state).toEqual(state('none'));
    controller.request({ level: 'soft' });
    controller.request({ level: 'soft' });
    controller.request({ level: 'hard' });
    controller.request({ level: 'soft' });
    expect(controller.state).toEqual(state('hard', 'operator'));
    expect(seen).toEqual([state('soft', 'operator'), state('hard', 'operator')]);
  });

  test('the signal aborts exactly once, when the level first becomes hard', () => {
    const controller = createStopController();
    const calls: string[] = [];
    controller.signal.onAbort(() => calls.push('first'));
    const removed = controller.signal.onAbort(() => calls.push('removed'));
    removed();
    controller.request({ level: 'soft' });
    expect(controller.signal.aborted).toBe(false);
    controller.request({ level: 'hard' });
    controller.request({ level: 'hard' });
    controller.signal.onAbort(() => calls.push('late'));
    expect(controller.signal.aborted).toBe(true);
    expect(calls).toEqual(['first', 'late']);
  });

  test('a soft stop has no default deadline: thirty days later it is still soft and nothing aborted', () => {
    const timer = fakeTimer();
    const controller = createStopController({ timer });
    controller.request({ level: 'soft' });
    timer.advance(30 * 24 * hour);
    expect(controller.state).toEqual(state('soft', 'operator'));
    expect(controller.signal.aborted).toBe(false);
    expect(timer.scheduled).toEqual([]);
  });

  test('an operator deadline escalates an unfinished soft stop to hard, with deadline as its cause', () => {
    const timer = fakeTimer();
    const controller = createStopController({ timer });
    const seen: IStopState[] = [];
    controller.subscribe((next) => seen.push(next));
    controller.request({ level: 'soft', deadline: T0 + 10 * 60_000 });
    expect(controller.state).toEqual(state('soft', 'operator', T0 + 10 * 60_000));
    timer.advance(10 * 60_000 - 1);
    expect(controller.state.level).toBe('soft');
    timer.advance(1);
    expect(controller.state).toEqual(state('hard', 'deadline'));
    expect(controller.signal.aborted).toBe(true);
    expect(seen.map((entry) => `${entry.level}:${String(entry.cause)}`)).toEqual(['soft:operator', 'hard:deadline']);
    // A deadline never prolongs the host's life on its own.
    expect(timer.scheduled.map((entry) => entry.keepAlive)).toEqual([false]);
  });

  test('a later request can bring a deadline earlier but never postpone it', () => {
    const timer = fakeTimer();
    const controller = createStopController({ timer });
    controller.request({ level: 'soft', deadline: T0 + 5_000 });
    controller.request({ level: 'soft', deadline: T0 + 9_000 });
    expect(controller.state.deadline).toBe(T0 + 5_000);
    controller.request({ level: 'soft', deadline: T0 + 2_000 });
    expect(controller.state.deadline).toBe(T0 + 2_000);
    timer.advance(2_000);
    expect(controller.state).toEqual(state('hard', 'deadline'));
  });

  test('an operator hard stop before the deadline disarms it, and a deadline already reached escalates at once', () => {
    const timer = fakeTimer();
    const controller = createStopController({ timer });
    controller.request({ level: 'soft', deadline: T0 + 5_000 });
    controller.request({ level: 'hard' });
    timer.advance(10_000);
    expect(controller.state).toEqual(state('hard', 'operator'));
    expect(timer.scheduled.every((entry) => entry.cancelled || !entry.fired)).toBe(true);
    const late = createStopController({ timer });
    late.request({ level: 'soft', deadline: timer.currentEpochMilliseconds() });
    expect(late.state).toEqual(state('hard', 'deadline'));
  });

  test.each([
    ['a missing level', { level: undefined }],
    ['an unknown level', { level: 'pause' }],
    ['a fractional deadline', { level: 'soft', deadline: T0 + 0.5 }],
    ['a deadline on a hard stop', { level: 'hard', deadline: T0 }],
  ])('a malformed request (%s) is refused and changes nothing', async (_label, request) => {
    const controller = createStopController({ timer: fakeTimer() });
    // Deliberately malformed, as untyped operator code could send.
    expect(await codeOf(() => controller.request(request as never))).toBe('invalid-request');
    expect(controller.state).toEqual(state('none'));
  });

  test('a deadline cannot be requested without a timer to arm it', async () => {
    const controller = createStopController();
    expect(await codeOf(() => controller.request({ level: 'soft', deadline: T0 }))).toBe('invalid-request');
    expect(controller.state).toEqual(state('none'));
  });

  test('a subscriber that throws neither prevents the change nor other subscribers', () => {
    const controller = createStopController();
    const seen: string[] = [];
    controller.subscribe(() => {
      throw new Error('subscriber failed');
    });
    controller.subscribe((next) => seen.push(next.level));
    controller.request({ level: 'hard' });
    expect(controller.state.level).toBe('hard');
    expect(seen).toEqual(['hard']);
  });
});

describe('admission under stop intent (RUN-014: no admission after a soft stop)', () => {
  test('before a stop admission follows the policy; after a soft or hard stop new work is cancelled', async () => {
    const double = portDouble();
    const controller = createStopController();
    const decisions: unknown[] = [];
    await supervisionWith(fakeTimer()).run(optionsFor(double, { stop: controller }), async () => {
      const { admission } = double.ports();
      decisions.push(await admission.admit(admissionFor(stepOf('a'))));
      controller.request({ level: 'soft' });
      decisions.push(await admission.admit(admissionFor(stepOf('b'))));
      controller.request({ level: 'hard' });
      decisions.push(await admission.admit(admissionFor(stepOf('c'))));
    });
    expect(decisions).toEqual([
      { kind: 'admitted' },
      { kind: 'cancelled', reason: expect.stringContaining('soft stop') },
      { kind: 'cancelled', reason: expect.stringContaining('hard stop') },
    ]);
  });

  test('a decision still pending when a stop arrives is cancelled, soft or hard', async () => {
    for (const level of ['soft', 'hard'] as const) {
      const double = portDouble();
      const controller = createStopController();
      const pending = deferred<{ readonly kind: 'admitted' }>();
      let decided: unknown;
      await supervisionWith(fakeTimer()).run(optionsFor(double, { stop: controller, admission: { admit: () => pending.promise } }), async () => {
        const decision = double.ports().admission.admit(admissionFor(stepOf('a')));
        await settle();
        controller.request({ level });
        if (level === 'soft') {
          // A soft stop does not abort the policy; its later answer is still replaced.
          pending.resolve({ kind: 'admitted' });
        }
        decided = await decision;
      });
      expect(decided).toEqual({ kind: 'cancelled', reason: expect.stringContaining(`${level} stop`) });
    }
  });

  test('a run started under a controller that is already stopped admits nothing and reports the stop', async () => {
    const double = portDouble();
    const controller = createStopController();
    controller.request({ level: 'soft' });
    const events: IRunEvent[] = [];
    const result = await supervisionWith(fakeTimer()).run(optionsFor(double, { stop: controller, observers: [{ observe: (event) => events.push(event) }] }), () =>
      double.ports().admission.admit(admissionFor(stepOf('a'))));
    expect(result.value).toMatchObject({ kind: 'cancelled' });
    expect(result.stop).toEqual(state('soft', 'operator'));
    expect(controlEvents(events)).toEqual(['stop:soft:operator']);
  });
});

describe('supervised execution and the publication commit (RUN-015, EXP-8 mechanism 2)', () => {
  test('a soft stop lets an admitted body drain to its own result, and publication may proceed', async () => {
    const double = portDouble();
    const controller = createStopController();
    const gate = deferred();
    const outcome = await supervisionWith(fakeTimer()).run(optionsFor(double, { stop: controller }), async () => {
      const { execution } = double.ports();
      const running = execution.execute(stepOf('a'), async () => {
        await gate.promise;
        return { done: true };
      });
      await settle();
      controller.request({ level: 'soft' });
      gate.resolve();
      return { executed: await running, refusal: execution.publicationRefusal() };
    });
    expect(outcome.value).toEqual({ executed: { kind: 'returned', value: { done: true } }, refusal: undefined });
  });

  test('a hard stop interrupts a body that never settles, and forbids any later commit', async () => {
    const double = portDouble();
    const controller = createStopController();
    const outcome = await supervisionWith(fakeTimer()).run(optionsFor(double, { stop: controller }), async () => {
      const { execution } = double.ports();
      const before = execution.publicationRefusal();
      const running = execution.execute(stepOf('a'), () => new Promise<never>(() => undefined));
      await settle();
      controller.request({ level: 'hard' });
      return { executed: await running, before, after: execution.publicationRefusal() };
    });
    expect(outcome.value).toEqual({
      executed: { kind: 'interrupted', reason: expect.stringContaining('hard stop') },
      before: undefined,
      after: expect.stringContaining('hard stop'),
    });
  });

  test('a body presented after a hard stop is never started', async () => {
    const double = portDouble();
    const controller = createStopController();
    let started = false;
    const outcome = await supervisionWith(fakeTimer()).run(optionsFor(double, { stop: controller }), async () => {
      controller.request({ level: 'hard' });
      return double.ports().execution.execute(stepOf('a'), () => {
        started = true;
        return Promise.resolve('output');
      });
    });
    expect(started).toBe(false);
    expect(outcome.value).toEqual({ kind: 'interrupted', reason: expect.stringContaining('hard stop') });
  });

  test('a body failure is its own, and supervised execution never rejects', async () => {
    const double = portDouble();
    const failure = new Error('body failed');
    const outcome = await supervisionWith(fakeTimer()).run(optionsFor(double), () =>
      double.ports().execution.execute(stepOf('a'), () => Promise.reject(failure)));
    expect(outcome.value).toEqual({ kind: 'threw', error: failure });
  });
});

describe('the permit pool (RUN-002)', () => {
  test('sends run concurrently up to the permit bound, and waiting for a permit holds none', async () => {
    const double = portDouble();
    const provider = stubProvider();
    const supervisor = supervisionWith(fakeTimer());
    const labels = ['s1', 's2', 's3', 's4', 's5'];
    await supervisor.run(optionsFor(double, { permits: 2 }), async () => {
      const sends = labels.map((label) => supervisor.execution().send({ label, perform: provider.request(label, label) }));
      await settle();
      expect(provider.received).toEqual(['s1', 's2']);
      provider.release('s1');
      await settle();
      expect(provider.received).toEqual(['s1', 's2', 's3']);
      for (const label of labels) {
        provider.release(label);
        await settle();
      }
      expect(await Promise.all(sends)).toEqual(labels);
    });
    expect(provider.peak).toBe(2);
    expect(provider.completed).toEqual(labels);
  });

  test('the fan-out window is independent of permits: by default 8 members resolve at once, first in first out, whatever the permit bound', async () => {
    /** How many members a run lets resolve at once, and in what order they started. */
    const probe = async (overrides: Partial<IRunOptions>): Promise<{ readonly peak: number; readonly started: readonly number[] }> => {
      const double = portDouble();
      const gate = deferred();
      const started: number[] = [];
      let active = 0;
      let peak = 0;
      await supervisionWith(fakeTimer()).run(optionsFor(double, overrides), async () => {
        const members = Array.from({ length: 12 }, (_unused, index) => double.ports().execution.member(async () => {
          started.push(index);
          active += 1;
          peak = Math.max(peak, active);
          await gate.promise;
          active -= 1;
        }));
        await settle();
        gate.resolve();
        await Promise.all(members);
      });
      return { peak, started };
    };
    const ordered = Array.from({ length: 12 }, (_unused, index) => index);
    expect(await probe({})).toEqual({ peak: 8, started: ordered });
    expect(await probe({ permits: 3 })).toEqual({ peak: 8, started: ordered });
    expect(await probe({ permits: 1, window: 2 })).toEqual({ peak: 2, started: ordered });
  });

  test('a member waiting for a time lends its lane: with one lane a sibling runs meanwhile, and the sleeper reclaims a lane on waking', async () => {
    const timer = fakeTimer();
    const double = portDouble();
    const supervisor = supervisionWith(timer);
    const order: string[] = [];
    const siblingGate = deferred();
    await supervisor.run(optionsFor(double, { window: 1 }), async () => {
      const { execution } = double.ports();
      const sleeper = execution.member(async () => {
        order.push('sleeper:start');
        await supervisor.execution().sleepUntil(T0 + hour);
        order.push('sleeper:woke');
      });
      const sibling = execution.member(async () => {
        order.push('sibling:start');
        await siblingGate.promise;
        order.push('sibling:end');
      });
      await settle();
      // The sibling holds the only lane while the sleeper waits.
      expect(order).toEqual(['sleeper:start', 'sibling:start']);
      timer.advance(hour);
      await settle();
      // The sleeper's time has come, but it resumes only once a lane is free.
      expect(order).toEqual(['sleeper:start', 'sibling:start']);
      siblingGate.resolve();
      await Promise.all([sleeper, sibling]);
    });
    expect(order).toEqual(['sleeper:start', 'sibling:start', 'sibling:end', 'sleeper:woke']);
  });

  test('a waking member reclaims a lane ahead of members that have not started, and wakers are served among themselves first in, first out', async () => {
    const timer = fakeTimer();
    const double = portDouble();
    const supervisor = supervisionWith(timer);
    const order: string[] = [];
    const holderGate = deferred();
    await supervisor.run(optionsFor(double, { window: 1 }), async () => {
      const { execution } = double.ports();
      /** A member that waits for a time, then resumes (holding its claimed attempt's evidence meanwhile). */
      const sleeper = (name: string, until: number): Promise<void> => execution.member(async () => {
        order.push(`${name}:start`);
        await supervisor.execution().sleepUntil(until);
        order.push(`${name}:woke`);
      });
      const first = sleeper('first', T0 + hour);
      await settle();
      const second = sleeper('second', T0 + hour + 1);
      await settle();
      // The holder takes the lane both sleepers lent; three more members queue behind it, not yet started.
      const holder = execution.member(async () => {
        order.push('holder:start');
        await holderGate.promise;
        order.push('holder:end');
      });
      const queued = ['q1', 'q2', 'q3'].map((name) => execution.member(async () => {
        order.push(`${name}:start`);
        await Promise.resolve();
      }));
      await settle();
      expect(order).toEqual(['first:start', 'second:start', 'holder:start']);
      // Both sleepers wake while the holder still has the only lane, the first before the second.
      timer.advance(hour + 1);
      await settle();
      holderGate.resolve();
      await Promise.all([first, second, holder, ...queued]);
    });
    // Woken members resume before any unstarted member starts, in the order they woke.
    expect(order).toEqual(['first:start', 'second:start', 'holder:start', 'holder:end', 'first:woke', 'second:woke', 'q1:start', 'q2:start', 'q3:start']);
  });

  test('CMP-9: every run operation, started inside a member or a step attempt, is refused at once as an undeclared call, and the run completes (RUN-002)', async () => {
    let captured: IResolutionPorts | undefined;
    const resolution = (ports: IResolutionPorts): IResolution => {
      captured = ports;
      return portDouble().factory(ports);
    };
    const step = stepOf('summary', 'person:ada');
    const request = { requestKey: 'nested' };
    const result = await supervisionWith(fakeTimer()).run({ ...optionsFor(portDouble(), { window: 1 }), resolution }, async (run) => {
      const { execution } = captured ?? (() => {
        throw new Error('the run has not started');
      })();
      /** Call every run operation where this runs; each settles to its Supervision code. */
      const callEach = (): Promise<(string | undefined)[]> => Promise.all([
        codeOf(run.resolve(step, request)),
        codeOf(run.resolveMembers({ template: 'contributor', step: 'summary' }, request)),
        codeOf(run.resolveFold(stepOf('report'), request)),
        codeOf(run.resolveOutcomeFold(stepOf('tally'), request)),
        codeOf(run.check(step)),
        codeOf(run.recover(step, request)),
        codeOf(run.ordinary('note', () => 'noted')),
        codeOf(() => {
          run.assertDeclaredCall('read');
        }),
      ]);
      // The member holds the run's only lane: a refusal must never wait for one.
      const fromMember = await execution.member(callEach);
      const fromAttempt = await execution.execute(step, callEach);
      // The same operations from the run body itself are not refused.
      const fromBody = await codeOf(run.ordinary('note', () => 'noted'));
      return { fromMember, fromAttempt, fromBody };
    });
    const refused = Array.from({ length: 8 }, () => 'undeclared-call');
    expect(result.value.fromMember).toEqual(refused);
    expect(result.value.fromAttempt).toEqual({ kind: 'returned', value: refused });
    expect(result.value.fromBody).toBeUndefined();
    // Each refusal is a run diagnostic naming the operation and where it was called, by identifiers only.
    const refusals = result.diagnostics.filter((diagnostic) => diagnostic.includes('undeclared call'));
    expect(refusals).toHaveLength(16);
    for (const operation of ['resolve', 'resolveMembers', 'resolveFold', 'resolveOutcomeFold', 'check', 'recover', 'ordinary', 'read']) {
      expect(refusals).toContain(`Run ${result.context.runId} refused ${operation} from inside member work: an undeclared call (CMP-9)`);
      expect(refusals).toContain(`Run ${result.context.runId} refused ${operation} from inside the step attempt of summary/person:ada: an undeclared call (CMP-9)`);
    }
  });

  test.each([
    ['zero permits', { permits: 0 }],
    ['fractional permits', { permits: 1.5 }],
    ['a zero window', { window: 0 }],
  ])('a run with %s is refused before it starts', async (_label, overrides) => {
    let ran = false;
    expect(await codeOf(supervisionWith(fakeTimer()).run(optionsFor(portDouble(), overrides), () => {
      ran = true;
    }))).toBe('invalid-request');
    expect(ran).toBe(false);
  });
});

describe('sends under stop intent (RUN-014)', () => {
  /** Run `body` as a step body through the cancellation port, inside a run with `controller`. */
  async function inStep<T>(options: { readonly controller: ReturnType<typeof createStopController>; readonly permits?: number; readonly events?: IRunEvent[] }, body: (supervisor: ISupervision, execution: () => IRunExecution) => Promise<T>): Promise<{ readonly executed: unknown; readonly interruptions: readonly unknown[] }> {
    const double = portDouble();
    const supervisor = supervisionWith(fakeTimer());
    const events = options.events ?? [];
    const result = await supervisor.run(optionsFor(double, { stop: options.controller, permits: options.permits ?? 1, observers: [{ observe: (event) => events.push(event) }] }), () =>
      double.ports().execution.execute(stepOf('step'), () => body(supervisor, () => supervisor.execution())));
    return { executed: result.value, interruptions: result.interruptions };
  }

  test('a draining step keeps sending first attempts after a soft stop, but a retry is refused without sending', async () => {
    const controller = createStopController();
    const provider = stubProvider();
    const events: IRunEvent[] = [];
    const outcome = await inStep({ controller, events }, async (_supervisor, execution) => {
      controller.request({ level: 'soft' });
      provider.release('first');
      const first = await execution().send({ label: 'first', perform: provider.request('first', 1) });
      const retry = await codeOf(execution().send({ label: 'retry', retry: true, perform: provider.request('retry', 2) }));
      return { first, retry };
    });
    expect(provider.received).toEqual(['first']);
    // The body returned, but a refused retry means its output can never be published.
    expect(outcome.executed).toEqual({ kind: 'interrupted', reason: expect.stringContaining('soft stop') });
    expect(controlEvents(events)).toEqual(['stop:soft:operator', 'send:first:begin', 'send:first:end', 'send:retry:refused']);
  });

  test('once a step attempt was refused, it sends nothing more, even a first attempt (taint guard)', async () => {
    const controller = createStopController();
    const provider = stubProvider();
    const codes: unknown[] = [];
    await inStep({ controller }, async (_supervisor, execution) => {
      controller.request({ level: 'soft' });
      codes.push(await codeOf(execution().send({ label: 'retry', retry: true, perform: provider.request('retry', 1) })));
      provider.release('again');
      codes.push(await codeOf(execution().send({ label: 'again', perform: provider.request('again', 2) })));
    });
    expect(codes).toEqual(['stopped', 'stopped']);
    expect(provider.received).toEqual([]);
  });

  test('a send outside any admitted step is new work: a soft stop refuses it', async () => {
    const controller = createStopController();
    const provider = stubProvider();
    const double = portDouble();
    const supervisor = supervisionWith(fakeTimer());
    const codes: unknown[] = [];
    await supervisor.run(optionsFor(double, { stop: controller }), async () => {
      provider.release('before');
      codes.push(await codeOf(supervisor.execution().send({ label: 'before', perform: provider.request('before', 1) })));
      controller.request({ level: 'soft' });
      codes.push(await codeOf(supervisor.execution().send({ label: 'after', perform: provider.request('after', 2) })));
    });
    expect(codes).toEqual([undefined, 'stopped']);
    expect(provider.received).toEqual(['before']);
  });

  test('a hard stop aborts a send in flight: the permit is released and the remote state is unknown without provider cancellation', async () => {
    const controller = createStopController();
    const provider = stubProvider();
    const events: IRunEvent[] = [];
    const double = portDouble();
    const supervisor = supervisionWith(fakeTimer());
    let code: string | undefined;
    const result = await supervisor.run(optionsFor(double, { stop: controller, observers: [{ observe: (event) => events.push(event) }] }), async () => {
      const executed = double.ports().execution.execute(stepOf('step'), async () => {
        code = await codeOf(supervisor.execution().send({ label: 'generate', perform: provider.request('generate', 'text') }));
        return 'partial';
      });
      await settle();
      expect(provider.inFlight).toBe(1);
      controller.request({ level: 'hard' });
      return executed;
    });
    // The detached body sees its send rejected in the same abort; nothing it returns afterwards is used.
    await settle();
    expect(code).toBe('stopped');
    expect(provider.aborted).toEqual(['generate']);
    expect(provider.completed).toEqual([]);
    expect(result.value).toEqual({ kind: 'interrupted', reason: expect.stringContaining('hard stop') });
    expect(result.interruptions).toEqual([{ label: 'generate', remote: 'unknown' }]);
    expect(controlEvents(events)).toEqual(['send:generate:begin', 'stop:hard:operator', 'send:generate:aborted', 'send:generate:remote-state:unknown']);
  });

  test.each([
    ['cancelled', async (): Promise<'cancelled' | 'running'> => 'cancelled', 'cancelled'],
    ['running', async (): Promise<'cancelled' | 'running'> => 'running', 'running'],
    ['unknown when the cancellation request fails', async (): Promise<'cancelled' | 'running'> => Promise.reject(new Error('provider unreachable')), 'unknown'],
  ] as const)('provider cancellation after a local abort records the remote state as %s', async (_label, cancel, remote) => {
    const controller = createStopController();
    const provider = stubProvider();
    const events: IRunEvent[] = [];
    const double = portDouble();
    const supervisor = supervisionWith(fakeTimer());
    const result = await supervisor.run(optionsFor(double, { stop: controller, observers: [{ observe: (event) => events.push(event) }] }), async () => {
      const sending = codeOf(supervisor.execution().send({ label: 'generate', perform: provider.request('generate', 'text'), cancel }));
      await settle();
      controller.request({ level: 'hard' });
      return sending;
    });
    expect(result.value).toBe('stopped');
    expect(result.interruptions).toEqual([{ label: 'generate', remote }]);
    expect(controlEvents(events)).toEqual(['send:generate:begin', 'stop:hard:operator', 'send:generate:aborted', 'send:generate:cancel-requested', `send:generate:remote-state:${remote}`]);
  });

  test('a hard stop reaches a send queued for a permit: it is never sent and no permit is lost', async () => {
    const controller = createStopController();
    const provider = stubProvider({ settleOnAbort: true });
    const double = portDouble();
    const supervisor = supervisionWith(fakeTimer());
    const codes = await supervisor.run(optionsFor(double, { stop: controller, permits: 1 }), async () => {
      const first = codeOf(supervisor.execution().send({ label: 'first', perform: provider.request('first', 1) }));
      const queued = codeOf(supervisor.execution().send({ label: 'queued', perform: provider.request('queued', 2) }));
      await settle();
      expect(provider.received).toEqual(['first']);
      controller.request({ level: 'hard' });
      return Promise.all([first, queued]);
    });
    expect(codes.value).toEqual(['stopped', 'stopped']);
    expect(provider.received).toEqual(['first']);
  });

  test('a send that fails on its own rejects with its own error and does not stop the step', async () => {
    const controller = createStopController();
    const failure = new Error('provider unavailable');
    const outcome = await inStep({ controller }, async (_supervisor, execution) => {
      const caught = await execution().send({ label: 'flaky', perform: () => Promise.reject(failure) }).catch((error: unknown) => error);
      return caught === failure ? 'handled' : 'wrong error';
    });
    expect(outcome.executed).toEqual({ kind: 'returned', value: 'handled' });
  });

  test('a malformed send is refused as an invalid request', async () => {
    const double = portDouble();
    const supervisor = supervisionWith(fakeTimer());
    const codes = await supervisor.run(optionsFor(double), () => Promise.all([
      codeOf(supervisor.execution().send({ label: '', perform: () => Promise.resolve(1) })),
      // Deliberately malformed, as untyped author code could send.
      codeOf(supervisor.execution().send({ label: 'x', perform: undefined } as never)),
    ]));
    expect(codes.value).toEqual(['invalid-request', 'invalid-request']);
  });
});

describe('waiting for a time (RUN-011 waits hold no permit; RUN-014 stops reach them)', () => {
  test('a wait holds no permit: a send proceeds while another execution waits', async () => {
    const timer = fakeTimer();
    const double = portDouble();
    const provider = stubProvider();
    const supervisor = supervisionWith(timer);
    const order: string[] = [];
    await supervisor.run(optionsFor(double, { permits: 1 }), async () => {
      const waiting = supervisor.execution().sleepUntil(T0 + 3 * hour).then(() => order.push('woke'));
      provider.release('sibling');
      order.push(`sent ${String(await supervisor.execution().send({ label: 'sibling', perform: provider.request('sibling', 1) }))}`);
      timer.advance(3 * hour);
      await waiting;
    });
    expect(order).toEqual(['sent 1', 'woke']);
    // A waiting run must not end early, so the wait keeps the host alive.
    expect(timer.scheduled.map((entry) => entry.keepAlive)).toEqual([true]);
  });

  test.each(['soft', 'hard'] as const)('a %s stop ends a wait at once, without waiting for its time', async (level) => {
    const timer = fakeTimer();
    const controller = createStopController();
    const double = portDouble();
    const supervisor = supervisionWith(timer);
    const result = await supervisor.run(optionsFor(double, { stop: controller }), async () => {
      const executed = double.ports().execution.execute(stepOf('deferred'), async () => {
        await supervisor.execution().sleepUntil(T0 + 3 * hour);
        return 'resumed';
      });
      await settle();
      controller.request({ level });
      return executed;
    });
    expect(result.value).toEqual({ kind: 'interrupted', reason: expect.stringContaining(`${level} stop`) });
    expect(timer.currentEpochMilliseconds()).toBe(T0);
    expect(timer.scheduled.every((entry) => entry.cancelled)).toBe(true);
  });

  test('a wait requested after a stop is refused, and a wait without a timer is an invalid request', async () => {
    const controller = createStopController();
    controller.request({ level: 'soft' });
    const supervisor = supervisionWith(fakeTimer());
    const stopped = await supervisor.run(optionsFor(portDouble(), { stop: controller }), () => codeOf(supervisor.execution().sleepUntil(T0 + hour)));
    expect(stopped.value).toBe('stopped');
    const untimed = createSupervision({ context: nodeScopes });
    const invalid = await untimed.run(optionsFor(portDouble()), () => codeOf(untimed.execution().sleepUntil(T0 + hour)));
    expect(invalid.value).toBe('invalid-request');
  });
});

describe('run-scoped lifecycle isolation (A-18, RUN-001)', () => {
  test('concurrent runs keep their own execution controls: stopping one never reaches the other', async () => {
    const supervisor = supervisionWith(fakeTimer());
    const provider = stubProvider();
    const first = createStopController();
    const second = createStopController();
    const seen: string[] = [];
    const firstRun = supervisor.run(optionsFor(portDouble(), { runId: 'run:first', stop: first }), async () => {
      seen.push(supervisor.execution().runId);
      return codeOf(supervisor.execution().send({ label: 'first', perform: provider.request('first', 1) }));
    });
    const secondRun = supervisor.run(optionsFor(portDouble(), { runId: 'run:second', stop: second }), async () => {
      seen.push(supervisor.execution().runId);
      const value = await supervisor.execution().send({ label: 'second', perform: provider.request('second', 2) });
      seen.push(`${supervisor.execution().runId}:${String(supervisor.execution().signal.aborted)}`);
      return value;
    });
    await settle();
    first.request({ level: 'hard' });
    await settle();
    provider.release('second');
    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
    expect(firstResult.value).toBe('stopped');
    expect(secondResult.value).toBe(2);
    expect(secondResult.stop).toEqual(state('none'));
    expect(seen).toEqual(['run:first', 'run:second', 'run:second:false']);
  });

  test('a nested step execution is attributed to its own step, and a thrown nested execution restores its parent', async () => {
    const double = portDouble();
    const supervisor = supervisionWith(fakeTimer());
    const seen: (string | undefined)[] = [];
    await supervisor.run(optionsFor(double), async () => {
      const { execution } = double.ports();
      seen.push(supervisor.execution().step?.slot);
      await execution.execute(stepOf('parent'), async () => {
        seen.push(supervisor.execution().step?.slot);
        const child = await execution.execute(stepOf('child'), async () => {
          seen.push(supervisor.execution().step?.slot);
          await Promise.resolve();
          throw new Error('child failed');
        });
        seen.push(child.kind);
        seen.push(supervisor.execution().step?.slot);
      });
      seen.push(supervisor.execution().step?.slot);
    });
    expect(seen).toEqual([undefined, 'parent', 'child', 'threw', 'parent', undefined]);
  });

  test('controls retained or looked up after the run closed fail clearly and send nothing', async () => {
    const supervisor = supervisionWith(fakeTimer());
    const provider = stubProvider();
    let kept: IRunExecution | undefined;
    const gate = deferred();
    let escaped: Promise<unknown> | undefined;
    await supervisor.run(optionsFor(portDouble()), () => {
      kept = supervisor.execution();
      escaped = codeOf(gate.promise.then(() => supervisor.execution()));
    });
    gate.resolve();
    expect(await escaped).toBe('run-closed');
    expect(kept).toBeDefined();
    if (kept !== undefined) {
      const late = kept;
      // Stop intent stays readable after close; only work is refused.
      expect(late.stop).toEqual(state('none'));
      expect(late.signal.aborted).toBe(false);
      expect(await codeOf(late.send({ label: 'late', perform: provider.request('late', 1) }))).toBe('run-closed');
      expect(await codeOf(late.sleepUntil(T0 + hour))).toBe('run-closed');
    }
    expect(await codeOf(() => supervisor.execution())).toBe('outside-run');
    expect(provider.received).toEqual([]);
  });
});

describe('stop events and the run report', () => {
  test('observers see stop changes, and an observer failure there is only a diagnostic', async () => {
    const timer = fakeTimer();
    const controller = createStopController({ timer });
    const double = portDouble();
    const events: IRunEvent[] = [];
    const result = await supervisionWith(timer).run(optionsFor(double, {
      stop: controller,
      observers: [
        { observe: (event) => { if (event.kind === 'stop') { throw new Error('observer failed'); } } },
        { observe: (event) => events.push(event) },
      ],
    }), async () => {
      controller.request({ level: 'soft', deadline: T0 + 1_000 });
      timer.advance(1_000);
      return double.ports().admission.admit(admissionFor(stepOf('a')));
    });
    expect(controlEvents(events)).toEqual(['stop:soft:operator', 'stop:hard:deadline']);
    expect(result.value).toMatchObject({ kind: 'cancelled' });
    expect(result.stop).toEqual(state('hard', 'deadline'));
    expect(result.diagnostics).toEqual([expect.stringContaining('observer failed'), expect.stringContaining('observer failed')]);
  });

  test('a stop requested after the run closed is not reported by it', async () => {
    const controller = createStopController();
    const events: IRunEvent[] = [];
    const result = await supervisionWith(fakeTimer()).run(optionsFor(portDouble(), { stop: controller, observers: [{ observe: (event) => events.push(event) }] }), () => 'done');
    controller.request({ level: 'hard' });
    expect(result.stop).toEqual(state('none'));
    expect(events).toEqual([]);
  });

  test('a stop error is a SupervisionError with the stopped code', async () => {
    const controller = createStopController();
    controller.request({ level: 'hard' });
    const supervisor = supervisionWith(fakeTimer());
    const result = await supervisor.run(optionsFor(portDouble(), { stop: controller }), () =>
      supervisor.execution().send({ label: 'x', perform: () => Promise.resolve(1) }).catch((error: unknown) => error));
    expect(result.value).toBeInstanceOf(SupervisionError);
    expect(result.value).toMatchObject({ code: 'stopped' });
  });
});

/**
 * Run `turnLimit` event-loop turns or until `done` holds; returns whether it
 * held. Lets a test detect work that would otherwise wait forever, then
 * unstick it (with a hard stop) so the run can still close and report.
 */
async function eventually(done: () => boolean, turnLimit = 50): Promise<boolean> {
  for (let turn = 0; turn < turnLimit && !done(); turn += 1) {
    await settle();
  }
  return done();
}

describe('permit waiters and stop intent (RUN-002, RUN-014)', () => {
  test('a waiter a soft stop cancels leaves the queue, so a draining step queued behind it still gets the permit', async () => {
    const controller = createStopController();
    const provider = stubProvider();
    const double = portDouble();
    const supervisor = supervisionWith(fakeTimer());
    const result = await supervisor.run(optionsFor(double, { stop: controller, permits: 1 }), async () => {
      const { execution } = double.ports();
      const a = execution.execute(stepOf('a'), () => supervisor.execution().send({ label: 'a', perform: provider.request('a', 1) }));
      await settle();
      // A retry queues first for the only permit; any stop refuses it.
      const r = execution.execute(stepOf('r'), () => supervisor.execution().send({ label: 'r', retry: true, perform: provider.request('r', 2) }));
      await settle();
      // A draining step's first attempt queues behind it.
      const b = execution.execute(stepOf('b'), () => supervisor.execution().send({ label: 'b', perform: provider.request('b', 3) }));
      await settle();
      controller.request({ level: 'soft' });
      provider.release('a');
      provider.release('b');
      const drained = await eventually(() => provider.completed.includes('b'));
      if (!drained) {
        controller.request({ level: 'hard' });
      }
      return { drained, a: await a, r: await r, b: await b };
    });
    expect(result.value).toEqual({
      drained: true,
      a: { kind: 'returned', value: 1 },
      r: { kind: 'interrupted', reason: expect.stringContaining('soft stop refuses retries') },
      b: { kind: 'returned', value: 3 },
    });
    expect(provider.received).toEqual(['a', 'b']);
  });

  test('a permit granted to a waiter just as a soft stop lands is handed straight back, and a draining step queued behind it proceeds', async () => {
    const controller = createStopController();
    const provider = stubProvider();
    const double = portDouble();
    const supervisor = supervisionWith(fakeTimer());
    // The stop lands in the very turn `a` hands its permit to the queued retry, before the retry's continuation runs.
    const stopAtHandOver: IRunObserver = {
      observe: (event) => {
        if (event.kind === 'send' && event.label === 'a' && event.phase === 'end') {
          controller.request({ level: 'soft' });
        }
      },
    };
    const result = await supervisor.run(optionsFor(double, { stop: controller, permits: 1, observers: [stopAtHandOver] }), async () => {
      const { execution } = double.ports();
      const a = execution.execute(stepOf('a'), () => supervisor.execution().send({ label: 'a', perform: provider.request('a', 1) }));
      await settle();
      const r = execution.execute(stepOf('r'), () => supervisor.execution().send({ label: 'r', retry: true, perform: provider.request('r', 2) }));
      await settle();
      const b = execution.execute(stepOf('b'), () => supervisor.execution().send({ label: 'b', perform: provider.request('b', 3) }));
      await settle();
      provider.release('a');
      provider.release('b');
      const drained = await eventually(() => provider.completed.includes('b'));
      if (!drained) {
        controller.request({ level: 'hard' });
      }
      return { drained, a: await a, r: await r, b: await b };
    });
    expect(result.value).toEqual({
      drained: true,
      a: { kind: 'returned', value: 1 },
      r: { kind: 'interrupted', reason: expect.stringContaining('soft stop refuses retries') },
      b: { kind: 'returned', value: 3 },
    });
    expect(provider.received).toEqual(['a', 'b']);
  });

  test('permit waiters are served first in, first out', async () => {
    const provider = stubProvider();
    const double = portDouble();
    const supervisor = supervisionWith(fakeTimer());
    const labels = ['p0', 'p1', 'p2', 'p3'];
    await supervisor.run(optionsFor(double, { permits: 1 }), async () => {
      const sends = labels.map((label) => supervisor.execution().send({ label, perform: provider.request(label, label) }));
      for (const label of labels) {
        await settle();
        provider.release(label);
      }
      await Promise.all(sends);
    });
    expect(provider.received).toEqual(labels);
  });
});

describe('the run stays open while its sends are outstanding (RUN-001, RUN-014)', () => {
  test('a body that returns while its send is still in flight does not close the run before the send settles', async () => {
    const provider = stubProvider();
    const double = portDouble();
    const supervisor = supervisionWith(fakeTimer());
    let sent: Promise<number> | undefined;
    let arrived = false;
    const running = supervisor.run(optionsFor(double), () => {
      sent = supervisor.execution().send({ label: 'gated', perform: provider.request('gated', 1) });
      return 'body returned';
    });
    void running.then(() => {
      arrived = true;
    });
    await settle();
    await settle();
    expect(provider.received).toEqual(['gated']);
    expect(arrived).toBe(false);
    provider.release('gated');
    const result = await running;
    expect(result.value).toBe('body returned');
    expect(await sent).toBe(1);
  });

  test('after a hard stop the run waits for a slow provider cancellation, and reports its remote state', async () => {
    const controller = createStopController();
    const provider = stubProvider();
    const double = portDouble();
    const supervisor = supervisionWith(fakeTimer());
    const cancellation = deferred<'cancelled' | 'running'>();
    let code: Promise<string | undefined> | undefined;
    let arrived = false;
    const running = supervisor.run(optionsFor(double, { stop: controller }), () => {
      code = codeOf(supervisor.execution().send({ label: 'slow', perform: provider.request('slow', 1), cancel: () => cancellation.promise }));
      return 'body returned';
    });
    void running.then(() => {
      arrived = true;
    });
    await settle();
    expect(provider.received).toEqual(['slow']);
    controller.request({ level: 'hard' });
    await settle();
    await settle();
    // The send was aborted locally; the provider has not yet answered the cancellation.
    expect(provider.aborted).toEqual(['slow']);
    expect(arrived).toBe(false);
    cancellation.resolve('cancelled');
    const result = await running;
    expect(await code).toBe('stopped');
    expect(result.interruptions).toEqual([{ label: 'slow', remote: 'cancelled' }]);
    expect(result.stop).toEqual(state('hard', 'operator'));
  });
});

describe('abort listeners are released once they can no longer run (regression: a settled step output stayed reachable until its run closed)', () => {
  test('removing a listener releases it, so the source returns to its baseline', () => {
    const source = createAbortSource();
    const baseline = source.listenerCount;
    const removers = Array.from({ length: 10 }, () => source.signal.onAbort(() => undefined));
    expect(source.listenerCount).toBe(baseline + 10);
    for (const remove of removers) {
      remove();
      remove();
    }
    expect(source.listenerCount).toBe(baseline);
  });

  test('a removed listener never runs, and removal after the abort does nothing', () => {
    const source = createAbortSource();
    const calls: string[] = [];
    const removed = source.signal.onAbort(() => calls.push('removed'));
    const kept = source.signal.onAbort(() => calls.push('kept'));
    removed();
    source.abort();
    kept();
    expect(calls).toEqual(['kept']);
    expect(source.listenerCount).toBe(0);
  });

  test('a race that settles releases its listener, so the value it resolved (a step output) is not retained by the signal', async () => {
    const source = createAbortSource();
    const baseline = source.listenerCount;
    for (let index = 0; index < 20; index += 1) {
      const raced = await raceAbort(Promise.resolve({ output: 'x'.repeat(10_000) }), source.signal);
      expect(raced.aborted).toBe(false);
    }
    await raceAbort(Promise.reject(new Error('body failed')), source.signal).catch(() => undefined);
    expect(source.listenerCount).toBe(baseline);
  });

  test('a permit waiter that is granted a permit releases its cancellation listener', async () => {
    const source = createAbortSource();
    const pool = createPermitPool(1);
    const first = await pool.acquire(source.signal);
    const queued = pool.acquire(source.signal);
    expect(source.listenerCount).toBe(1);
    first?.release();
    const granted = await queued;
    expect(granted).toBeDefined();
    expect(source.listenerCount).toBe(0);
    granted?.release();
  });

  /** A live run's state built by hand, so a test can read the listener count of its hard-stop source. */
  function handBuiltRun(): { readonly run: ISupervisedRun; readonly hard: IAbortSource } {
    const hard = createAbortSource();
    const run: ISupervisedRun = {
      context: Object.freeze({ runId: 'run:hand-built', analysis: 'analysis:test', environment: 'env:test' }),
      open: true,
      controller: createStopController(),
      hard,
      stopped: createAbortSource(),
      permits: createPermitPool(1),
      lanes: createPermitPool(1),
      timer: undefined,
      interruptions: [],
      report: () => undefined,
      diagnose: () => undefined,
      track: (operation) => operation(),
      publicationRefusal: () => undefined,
    };
    return { run, hard };
  }

  test('each send gets its own signal, detached once the send settles, so an adapter that never removes its listener retains nothing through the run', async () => {
    const { run, hard } = handBuiltRun();
    const controls = runControls({ run, attempt: undefined, lane: undefined });
    const baseline = hard.listenerCount;
    const seen: IAbortSignal[] = [];
    for (let index = 0; index < 10; index += 1) {
      const output = { big: 'x'.repeat(10_000) };
      await controls.send({
        label: 'careless',
        perform: (signal) => {
          seen.push(signal);
          // A careless adapter: its listener captures the output and is never removed.
          signal.onAbort(() => {
            void output;
          });
          return Promise.resolve(output);
        },
      });
    }
    await controls.send({ label: 'failing', perform: (signal) => { signal.onAbort(() => undefined); return Promise.reject(new Error('provider unavailable')); } }).catch(() => undefined);
    expect(hard.listenerCount).toBe(baseline);
    expect(seen.every((signal) => signal !== run.hard.signal && !signal.aborted)).toBe(true);
  });

  test('a send\'s own signal still aborts when a hard stop lands while it is in flight', async () => {
    const { run, hard } = handBuiltRun();
    const controls = runControls({ run, attempt: undefined, lane: undefined });
    const aborted: string[] = [];
    const sending = controls.send({
      label: 'in-flight',
      perform: (signal) => new Promise<number>(() => {
        signal.onAbort(() => aborted.push('adapter saw the abort'));
      }),
    });
    await settle();
    hard.abort();
    expect(await codeOf(sending)).toBe('stopped');
    expect(aborted).toEqual(['adapter saw the abort']);
    expect(run.interruptions).toEqual([{ label: 'in-flight', remote: 'unknown' }]);
  });
});
