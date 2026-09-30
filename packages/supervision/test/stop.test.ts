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

import { SupervisionError, createStopController, createSupervision } from '../src/index.js';
import type { IRunEvent, IRunExecution, IRunOptions, IStopState, ISupervision } from '../src/index.js';
import { T0, admissionFor, codeOf, deferred, fakeTimer, grantingWriter, hour, nodeScopes, portDouble, settle, stepOf, stubProvider } from './support.js';
import type { IFakeTimer, IPortDouble } from './support.js';

/** A Supervision over Node's real scope and the given fake timer. */
function supervisionWith(timer: IFakeTimer): ISupervision {
  return createSupervision({ context: nodeScopes, timer });
}

/** Run options over a port double. */
function optionsFor(double: IPortDouble, overrides: Partial<IRunOptions> = {}): IRunOptions {
  return { analysis: 'analysis:test', environment: 'env:test', resolution: double.factory, writer: grantingWriter, ...overrides };
}

/** The stop and send events a run offered, as compact strings. */
function controlEvents(events: readonly IRunEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.kind === 'stop') {
      return [`stop:${event.level}:${String(event.cause)}`];
    }
    if (event.kind === 'send') {
      return [`send:${event.label}:${event.phase}${event.phase === 'remote-state' ? `:${event.remote}` : ''}`];
    }
    return [];
  });
}

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

  test('the fan-out window Resolution receives defaults to the permit bound and can be set apart', async () => {
    const windows: number[] = [];
    for (const overrides of [{}, { permits: 3 }, { permits: 2, window: 5 }]) {
      const double = portDouble();
      await supervisionWith(fakeTimer()).run(optionsFor(double, overrides), () => {
        windows.push(double.ports().window);
      });
    }
    expect(windows).toEqual([1, 3, 5]);
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
