/** Source calls preserve source policy and reject memo substitution before dispatch (SCD-1/2). */
import { describe, expect, test } from '@jest/globals';
import { declarations } from '../src/index.js';
import type { ITestFamily } from './fixtures/contributors.js';

describe('source callable declarations', () => {
  test('declares a source with arguments, previous and current finality', () => {
    const builders = declarations<ITestFamily>();
    const detail = builders.sourceSlot<readonly [string], { readonly merged: boolean }>({ slot: 'detail' });
    const implementation = builders.suppliedSource<readonly [string], { readonly merged: boolean }>({
      run: ({ args, previous }) => ({ merged: args[0] === 'repo#101' && previous === undefined }),
      finality: ({ args, previous }) => args[0] === 'repo#101' && previous.data.merged,
    });
    expect(detail.kind).toBe('source-slot');
    expect(implementation.kind).toBe('supplied-source');
    expect(builders.supplySource({ slot: detail, declaration: implementation, subject: ([id]) => `detail:${String(id)}` }).declaration).toBe(implementation);
  });

  test('rejects missing, ambiguous and wrong-kind occupants before any author hook', () => {
    const builders = declarations<ITestFamily>();
    const detail = builders.sourceSlot<readonly [string], object>({ slot: 'detail' });
    const source = builders.suppliedSource<readonly [string], object>({ run: () => ({}) });
    const memo = builders.suppliedStep<readonly [string], object>({ run: () => ({}) });
    const memoSlot = builders.stepSlot<readonly [string], object>({ slot: 'detail' });
    const parent = builders.memo({ subject: 'summary', children: { detail }, run: () => ({}) });
    const registration = builders.supplySource({ slot: detail, declaration: source, subject: () => 'detail:repo#101' });
    const port = { active: () => undefined, dispatch: () => Promise.resolve({ data: undefined as never }), isTrackedView: () => false, argumentsJustified: () => true };
    for (const supplied of [[], [registration, registration], [builders.supply({ slot: memoSlot, declaration: memo, subject: () => 'detail:repo#101' })]]) {
      const composition = builders.compose({ scope: 'test', steps: [{ slot: 'summary', declaration: parent }], supplied });
      expect(() => builders.openInvocation(composition, { scope: 'test', role: 'step', slot: 'summary' }, port)).toThrow();
    }
  });
});

/** Slot tokens declare possible edges; they are never executable declarations themselves. */
test('source tokens are not executable declarations and callbacks use captured own-data options', async () => {
  const { isDeclaration } = await import('../src/index.js');
  const builders = declarations<ITestFamily>();
  const token = builders.sourceSlot<readonly [string], object>({ slot: 'detail' });
  expect(isDeclaration(token)).toBe(false);
});

/** Declaring reads captured descriptors once, so proxies cannot substitute unvalidated callbacks. */
test('source callbacks use captured own-data options', () => {
  const builders = declarations<ITestFamily>();
  const run = (): object => ({ merged: false });
  const options = new Proxy({ run }, { get: () => { throw new Error('options must be read through their captured own descriptors'); } });
  expect(builders.suppliedSource<readonly [string], object>(options).run).toBe(run);
});
