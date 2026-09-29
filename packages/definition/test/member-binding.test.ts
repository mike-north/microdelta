/**
 * Outcome tests for the member binding of template member steps. Every
 * instance of a template's member source (`run` and `finality`) and member
 * memo (`run`) receives `member`: the view Resolution's member supplier gives
 * for the template's collection and the instance descriptor, the same view a
 * gate receives. Definition only assembles that context; it never reads the
 * member record. Steps outside templates, including explicitly keyed M3
 * members, have no member binding.
 *
 * @see ../../../docs/spec/composition.md (CMP-4, EXP-4 template selection)
 * @see ../../../docs/plans/m4-composition.md (Templates, keys and gates)
 */
import { describe, expect, test } from '@jest/globals';

import type { IMemoInvocation, IPreviousSupplier, ISourceDeclaration, ISourceInvocation } from '../src/index.js';
import { expectDefinitionError } from './fixtures/assertions.js';
import type { ITestFamily } from './fixtures/contributors.js';
import { ada, compose, compositionStep, instanceDescriptor, keyedScope, memo, openInvocation, source, template, type IContributors } from './fixtures/keyed.js';
import { directInvoker, fakePort, supplying } from './fixtures/port.js';

/** What the member steps' callbacks saw, by callback. */
interface ISeen {
  run?: unknown;
  finality?: unknown;
  memo?: unknown;
}

/** A composition whose member source and memo record the member binding they receive. */
function buildBound() {
  const seen: ISeen = {};
  const contributors = source<IContributors>({ subject: 'contributors:bound', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
  const contributor = template({
    slot: 'contributor',
    collection: contributors,
    steps: (member) => {
      const activity = member.source<{ readonly owner: string }>({
        subject: member.subject('activity:bound'),
        finality: ({ member: bound }) => {
          seen.finality = bound;
          return true;
        },
        run: ({ member: bound }) => {
          seen.run = bound;
          return { owner: bound.key ?? '' };
        },
      });
      const summary = member.memo({
        subject: member.subject('summary:bound'),
        run: ({ member: bound }) => {
          seen.memo = bound;
          return bound.authored;
        },
      });
      return { activity, summary };
    },
  });
  const ordinary = memo({ subject: 'ordinary:bound', run: () => 'ordinary' });
  const composition = compose({
    scope: keyedScope,
    steps: [{ slot: 'contributors', declaration: contributors }, { slot: 'ordinary', declaration: ordinary }],
    members: [{ key: 'person:ada', steps: [{ slot: 'explicit', declaration: memo({ subject: 'explicit:bound', run: () => 'explicit' }) }] }],
    templates: [contributor],
  });
  composition.keyMembers('contributor', { members: [ada], status: 'complete' });
  return { composition, contributors, seen };
}

/** Ada's frozen previous activity carrier. */
const adaCarrier: unknown = Object.freeze({ data: Object.freeze({ owner: 'person:ada' }) });

/** A previous supplier handing over Ada's carrier, for whichever source declaration asks. */
const previous: IPreviousSupplier<ITestFamily> = {
  carrier: <TResult>(declaration: ISourceDeclaration<ITestFamily, TResult>): { readonly data: TResult } => {
    void declaration;
    // Test-only: the supplier deliberately returns the carrier the test configured.
    return adaCarrier as { readonly data: TResult };
  },
};

/** Narrow an open invocation to a source. */
function asSource(invocation: ReturnType<typeof openInvocation>): ISourceInvocation<ITestFamily> {
  if (invocation.kind !== 'source') {
    throw new Error(`expected a source invocation, got ${invocation.kind}`);
  }
  return invocation;
}

/** Narrow an open invocation to a memo. */
function asMemo(invocation: ReturnType<typeof openInvocation>): IMemoInvocation<ITestFamily> {
  if (invocation.kind !== 'memo') {
    throw new Error(`expected a memo invocation, got ${invocation.kind}`);
  }
  return invocation;
}

describe('member binding of template member steps (CMP-4)', () => {
  test('instance source run and finality, and member memo run, receive the supplier\'s member view for the collection and instance', () => {
    const { composition, contributors, seen } = buildBound();
    const activity = instanceDescriptor('activity', 'person:ada');
    const summary = instanceDescriptor('summary', 'person:ada');
    const asked: unknown[] = [];
    const view = Object.freeze({ ...ada });
    const sourceInvocation = asSource(openInvocation(composition, activity, fakePort().port));
    expect(sourceInvocation.apply({}, undefined, directInvoker(), supplying(view, asked))).toEqual({ owner: 'person:ada' });
    expect(sourceInvocation.applyFinality({}, previous, directInvoker(), supplying(view, asked))).toBe(true);
    const memoInvocation = asMemo(openInvocation(composition, summary, fakePort().port));
    expect(memoInvocation.apply({}, directInvoker(), supplying(view, asked))).toBe(3);
    expect(seen).toEqual({ run: view, finality: view, memo: view });
    expect(seen.run).toBe(view);
    // The supplier was asked for the template's own collection declaration and each instance descriptor.
    expect(asked).toEqual([contributors, activity, contributors, activity, contributors, summary]);
  });

  test('an instance applied without its member binding rejects before its callback runs', () => {
    const { composition, seen } = buildBound();
    const sourceInvocation = asSource(openInvocation(composition, instanceDescriptor('activity', 'person:ada'), fakePort().port));
    expectDefinitionError(() => sourceInvocation.apply({}, undefined, directInvoker()), 'invalid-bindings');
    expectDefinitionError(() => sourceInvocation.applyFinality({}, previous, directInvoker()), 'invalid-bindings');
    const memoInvocation = asMemo(openInvocation(composition, instanceDescriptor('summary', 'person:ada'), fakePort().port));
    expectDefinitionError(() => memoInvocation.apply({}, directInvoker()), 'invalid-bindings');
    expect(seen).toEqual({});
  });

  test('composition-level steps and explicit M3 members have no member binding: supplying one rejects', () => {
    const { composition } = buildBound();
    const asked: unknown[] = [];
    for (const step of [compositionStep('ordinary'), { scope: keyedScope, role: 'step' as const, slot: 'explicit', memberKey: 'person:ada' }]) {
      const invocation = asMemo(openInvocation(composition, step, fakePort().port));
      expectDefinitionError(() => invocation.apply({}, directInvoker(), supplying(ada, asked)), 'invalid-bindings');
      expect(invocation.apply({}, directInvoker())).not.toBeUndefined();
    }
    expect(asked).toEqual([]);
  });

  test('facade bindings cannot claim the member name of an instance context', () => {
    const { composition } = buildBound();
    const memoInvocation = asMemo(openInvocation(composition, instanceDescriptor('summary', 'person:ada'), fakePort().port));
    expectDefinitionError(() => memoInvocation.apply({ member: 'forged' }, directInvoker(), supplying(ada, [])), 'invalid-bindings');
  });
});
