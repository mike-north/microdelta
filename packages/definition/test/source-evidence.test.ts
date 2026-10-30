/**
 * Request evidence belongs to the source declaration being applied. This owner
 * test supplies opaque facade views and verifies context assembly without a
 * producer, run, storage operation or page traversal.
 */
import { expect, test } from '@jest/globals';

import { declarations, type IBindingFamily, type IPreviousCarrierFamily, type ITypeFamily } from '../src/index.js';

/** Opaque views keep this context-assembly test independent of Tracking mechanics. */
interface IOpaqueViews extends ITypeFamily { readonly output: unknown }
/** Previous carriers are irrelevant to a fresh evidence-bound source application. */
interface IOpaquePrevious extends IPreviousCarrierFamily { readonly output: { readonly data: unknown } }
/** A facade family with no ambient author bindings or execution authority. */
interface IFamily extends IBindingFamily {
  readonly views: IOpaqueViews;
  readonly previous: IOpaquePrevious;
  readonly outcomes: IOpaqueViews;
  readonly source: object;
  readonly memo: object;
}

/** Definition pairs an actual callback and context; this invoker executes only that pair. */
function invoke<TContext, TResult>(callback: (context: TContext) => TResult, context: TContext): TResult {
  return callback(context);
}

test('supplies captured source evidence through its dedicated context field', () => {
  const builders = declarations<IFamily>();
  let observed: unknown;
  const source = builders.source<object>({ subject: 'frontier', run: context => { observed = Reflect.get(context, 'evidence'); return {}; } });
  const composition = builders.compose({ scope: 'test', steps: [{ slot: 'frontier', declaration: source }] });
  const port = { active: () => undefined, dispatch: () => Promise.resolve({ data: undefined }), isTrackedView: () => false, argumentsJustified: () => true };
  const invocation = builders.openInvocation(composition, { scope: 'test', role: 'step', slot: 'frontier' }, port);
  if (invocation.kind !== 'source') { throw new Error('Expected an ordinary source invocation'); }
  const captured = Object.freeze({ members: Object.freeze([{ id: 'fixture/repo#101' }]), status: 'open' });
  const supplier = { view: () => captured };
  invocation.apply({}, undefined, invoke, undefined, supplier);
  expect(observed).toBe(captured);
  invocation.close();
  expect(() => invocation.apply({}, undefined, invoke, undefined, supplier)).toThrow();
});

test('ordinary bindings cannot impersonate the evidence supplier', () => {
  const builders = declarations<IFamily>();
  let calls = 0;
  const source = builders.source<object>({ subject: 'ordinary', run: context => {
    calls += 1;
    expect(Object.hasOwn(context, 'evidence')).toBe(false);
    return {};
  } });
  const composition = builders.compose({ scope: 'test', steps: [{ slot: 'ordinary', declaration: source }] });
  const port = { active: () => undefined, dispatch: () => Promise.resolve({ data: undefined }), isTrackedView: () => false, argumentsJustified: () => true };
  const invocation = builders.openInvocation(composition, { scope: 'test', role: 'step', slot: 'ordinary' }, port);
  if (invocation.kind !== 'source') { throw new Error('Expected ordinary source'); }
  invocation.apply({}, undefined, invoke);
  expect(() => invocation.apply({ evidence: {} }, undefined, invoke)).toThrow();
  expect(calls).toBe(1);
  invocation.close();
});
