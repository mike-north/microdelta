/**
 * Owner tests for what a soft stop drains: the drain unit is the admitted
 * step attempt, and a child call its executing body demands is part of that
 * drain (RUN-014; EXP-8 mechanism 1 and resolution 3; supervisor ruling on
 * nested children during a soft stop).
 *
 * EXP-8 selected "the drain unit is the admitted step attempt: it keeps
 * running and may issue its remaining first-attempt requests, then
 * publishes", and its resolution 3 has authors isolate each paid call in its
 * own child step. Refusing a draining parent's children would interrupt every
 * well-authored parent, which is the rejected request-granularity drain
 * (CX-1). The ruling these tests encode:
 *
 * - a child demanded by the body of an admitted, draining, untainted step
 *   attempt is admitted as a first attempt, transitively;
 * - its retries, deferral resumes and waits are still refused;
 * - work no executing admitted body demands (a new root, a fan-out member
 *   that has not started, a call a finished or tainted body makes) is new
 *   work and is cancelled;
 * - the spending bound during a soft stop is the operator deadline or a hard
 *   stop, which still interrupts the whole drain subtree.
 *
 * The port double drives admission and supervised execution exactly as
 * Resolution does: a child's admission is requested from inside its parent's
 * executing body, and the child's body runs in its own attempt.
 *
 * @see ../../../docs/spec/operations.md (RUN-014)
 * @see ../../../docs/plans/m5-operations.md (Selected execution contract: Stop, Reuse)
 * @see ../../../experiments/exp-8/decision.md (mechanism 1, CX-1, resolution 3)
 */
import { describe, expect, test } from '@jest/globals';

import { createStopController } from '../src/index.js';
import type { IRunEvent } from '../src/index.js';
import { T0, admissionFor, codeOf, controlEvents, deferred, fakeTimer, hour, optionsFor, portDouble, settle, stepOf, stubProvider, supervisionWith } from './support.js';

describe('a draining step attempt obtains the children its body demands', () => {
  test('after a soft stop a draining parent obtains a new child: it is admitted as a first attempt, sends, and the parent may publish', async () => {
    const double = portDouble();
    const controller = createStopController();
    const provider = stubProvider();
    const supervisor = supervisionWith(fakeTimer());
    const result = await supervisor.run(optionsFor(double, { stop: controller }), async () => {
      const { admission, execution } = double.ports();
      const parent = await execution.execute(stepOf('parent'), async () => {
        controller.request({ level: 'soft' });
        // A child the body demands only now, after the stop.
        const decision = await admission.admit(admissionFor(stepOf('child')));
        provider.release('child');
        const child = decision.kind === 'admitted'
          ? await execution.execute(stepOf('child'), () => supervisor.execution().send({ label: 'child', perform: provider.request('child', 7) }))
          : undefined;
        return { decision, child };
      });
      return { parent, refusal: execution.publicationRefusal() };
    });
    expect(result.value).toEqual({
      parent: { kind: 'returned', value: { decision: { kind: 'admitted' }, child: { kind: 'returned', value: 7 } } },
      refusal: undefined,
    });
    expect(provider.received).toEqual(['child']);
    expect(result.stop).toEqual({ level: 'soft', cause: 'operator', deadline: undefined });
  });

  test('the drain is transitive: a child admitted during the drain obtains its own child the same way', async () => {
    const double = portDouble();
    const controller = createStopController();
    const provider = stubProvider();
    const supervisor = supervisionWith(fakeTimer());
    provider.release('grandchild');
    const result = await supervisor.run(optionsFor(double, { stop: controller }), async () => {
      const { admission, execution } = double.ports();
      return execution.execute(stepOf('parent'), async () => {
        controller.request({ level: 'soft' });
        const child = await admission.admit(admissionFor(stepOf('child')));
        const executed = child.kind !== 'admitted' ? undefined : await execution.execute(stepOf('child'), async () => {
          const grandchild = await admission.admit(admissionFor(stepOf('grandchild')));
          const sent = grandchild.kind !== 'admitted' ? undefined : await execution.execute(stepOf('grandchild'), () => supervisor.execution().send({ label: 'grandchild', perform: provider.request('grandchild', 3) }));
          return { grandchild, sent };
        });
        return { child, executed };
      });
    });
    expect(result.value).toEqual({
      kind: 'returned',
      value: {
        child: { kind: 'admitted' },
        executed: { kind: 'returned', value: { grandchild: { kind: 'admitted' }, sent: { kind: 'returned', value: 3 } } },
      },
    });
    expect(provider.received).toEqual(['grandchild']);
  });

  test('the caller\'s admission policy still decides a drained child', async () => {
    const double = portDouble();
    const controller = createStopController();
    const supervisor = supervisionWith(fakeTimer());
    const result = await supervisor.run(optionsFor(double, { stop: controller, admission: { admit: () => ({ kind: 'denied', reason: 'budget exhausted' }) } }), async () => {
      const { admission, execution } = double.ports();
      return execution.execute(stepOf('parent'), async () => {
        controller.request({ level: 'soft' });
        return admission.admit(admissionFor(stepOf('child')));
      });
    });
    expect(result.value).toEqual({ kind: 'returned', value: { kind: 'denied', reason: 'budget exhausted' } });
  });
});

describe('a child admitted during the drain may not retry, resume or wait', () => {
  test('its retry is refused without sending, and the child attempt can no longer publish', async () => {
    const double = portDouble();
    const controller = createStopController();
    const provider = stubProvider();
    const events: IRunEvent[] = [];
    const supervisor = supervisionWith(fakeTimer());
    provider.release('child:first');
    const result = await supervisor.run(optionsFor(double, { stop: controller, observers: [{ observe: (event) => events.push(event) }] }), async () => {
      const { admission, execution } = double.ports();
      return execution.execute(stepOf('parent'), async () => {
        controller.request({ level: 'soft' });
        const decision = await admission.admit(admissionFor(stepOf('child')));
        const child = decision.kind !== 'admitted' ? undefined : await execution.execute(stepOf('child'), async () => {
          const first = await supervisor.execution().send({ label: 'child:first', perform: provider.request('child:first', 1) });
          const retry = await codeOf(supervisor.execution().send({ label: 'child:retry', retry: true, perform: provider.request('child:retry', 2) }));
          return { first, retry };
        });
        return { decision, child };
      });
    });
    expect(result.value).toEqual({
      kind: 'returned',
      value: { decision: { kind: 'admitted' }, child: { kind: 'interrupted', reason: expect.stringContaining('soft stop refuses retries') } },
    });
    expect(provider.received).toEqual(['child:first']);
    expect(controlEvents(events)).toEqual(['stop:soft:operator', 'send:child:first:begin', 'send:child:first:end', 'send:child:retry:refused']);
  });

  test('its wait before a deferred resumption is refused, so the deferral never resumes during the drain', async () => {
    const double = portDouble();
    const controller = createStopController();
    const timer = fakeTimer();
    const supervisor = supervisionWith(timer);
    const result = await supervisor.run(optionsFor(double, { stop: controller }), async () => {
      const { admission, execution } = double.ports();
      return execution.execute(stepOf('parent'), async () => {
        controller.request({ level: 'soft' });
        const decision = await admission.admit(admissionFor(stepOf('child')));
        return decision.kind !== 'admitted' ? decision : execution.execute(stepOf('child'), async () => {
          await supervisor.execution().sleepUntil(T0 + hour);
          return 'resumed';
        });
      });
    });
    expect(result.value).toEqual({ kind: 'returned', value: { kind: 'interrupted', reason: expect.stringContaining('soft stop refuses the wait') } });
    expect(timer.scheduled).toEqual([]);
  });
});

describe('work no executing admitted body demands is new work, and a soft stop cancels it', () => {
  test('a root request, or a fan-out member that has not started, is cancelled', async () => {
    const double = portDouble();
    const controller = createStopController();
    const supervisor = supervisionWith(fakeTimer());
    const result = await supervisor.run(optionsFor(double, { stop: controller }), async () => {
      const { admission } = double.ports();
      controller.request({ level: 'soft' });
      return [await admission.admit(admissionFor(stepOf('root'))), await admission.admit(admissionFor(stepOf('work', 'item:2')))];
    });
    expect(result.value).toEqual([
      { kind: 'cancelled', reason: expect.stringContaining('soft stop') },
      { kind: 'cancelled', reason: expect.stringContaining('soft stop') },
    ]);
  });

  test('a child demanded by a tainted attempt is cancelled: an attempt that can never publish obtains nothing more', async () => {
    const double = portDouble();
    const controller = createStopController();
    const provider = stubProvider();
    const supervisor = supervisionWith(fakeTimer());
    let child: unknown;
    const result = await supervisor.run(optionsFor(double, { stop: controller }), async () => {
      const { admission, execution } = double.ports();
      return execution.execute(stepOf('parent'), async () => {
        controller.request({ level: 'soft' });
        await codeOf(supervisor.execution().send({ label: 'parent:retry', retry: true, perform: provider.request('parent:retry', 1) }));
        child = await admission.admit(admissionFor(stepOf('child')));
      });
    });
    expect(child).toEqual({ kind: 'cancelled', reason: expect.stringContaining('soft stop') });
    expect(result.value).toEqual({ kind: 'interrupted', reason: expect.stringContaining('soft stop refuses retries') });
    expect(provider.received).toEqual([]);
  });

  test('a call a body makes after its own execution ended is cancelled: no executing body demands it', async () => {
    const double = portDouble();
    const controller = createStopController();
    const supervisor = supervisionWith(fakeTimer());
    const later = deferred();
    let late: Promise<unknown> | undefined;
    await supervisor.run(optionsFor(double, { stop: controller }), async () => {
      const { admission, execution } = double.ports();
      const parent = await execution.execute(stepOf('parent'), () => {
        // Detached from the body's result: it runs after the body has returned.
        late = later.promise.then(() => admission.admit(admissionFor(stepOf('child'))));
        return Promise.resolve('returned');
      });
      expect(parent).toEqual({ kind: 'returned', value: 'returned' });
      controller.request({ level: 'soft' });
      later.resolve();
      await late;
    });
    expect(await late).toEqual({ kind: 'cancelled', reason: expect.stringContaining('soft stop') });
  });
});

describe('an operator deadline or a hard stop bounds the drain subtree', () => {
  test.each(['deadline', 'hard'] as const)('%s: a child obtained during the drain is interrupted mid-send, and neither it nor its parent can publish', async (escalation) => {
    const double = portDouble();
    const timer = fakeTimer();
    const controller = createStopController({ timer });
    const provider = stubProvider();
    const supervisor = supervisionWith(timer);
    const result = await supervisor.run(optionsFor(double, { stop: controller }), async () => {
      const { admission, execution } = double.ports();
      const children: Promise<unknown>[] = [];
      const parent = execution.execute(stepOf('parent'), async () => {
        controller.request({ level: 'soft', deadline: T0 + 1_000 });
        const decision = await admission.admit(admissionFor(stepOf('child')));
        if (decision.kind !== 'admitted') {
          return decision;
        }
        const child = execution.execute(stepOf('child'), () => supervisor.execution().send({ label: 'child', perform: provider.request('child', 1) }));
        children.push(child);
        return child;
      });
      await settle();
      expect(provider.inFlight).toBe(1);
      if (escalation === 'deadline') {
        timer.advance(1_000);
      } else {
        controller.request({ level: 'hard' });
      }
      const [child] = await Promise.all(children);
      return { parent: await parent, child, refusal: execution.publicationRefusal(), after: await admission.admit(admissionFor(stepOf('another'))) };
    });
    expect(result.value).toEqual({
      parent: { kind: 'interrupted', reason: expect.stringContaining('hard stop') },
      child: { kind: 'interrupted', reason: expect.stringContaining('hard stop') },
      refusal: expect.stringContaining('hard stop'),
      after: { kind: 'cancelled', reason: expect.stringContaining('hard stop') },
    });
    expect(provider.aborted).toEqual(['child']);
    expect(provider.completed).toEqual([]);
    expect(result.interruptions).toEqual([{ label: 'child', remote: 'unknown' }]);
    expect(result.stop).toEqual({ level: 'hard', cause: escalation === 'deadline' ? 'deadline' : 'operator', deadline: undefined });
  });
});
