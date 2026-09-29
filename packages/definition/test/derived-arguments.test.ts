/**
 * The derived values of a call's argument recipes, decoded by the owner of the
 * recipe encoding. Resolution rebuilds a recorded call's arguments from them
 * without running the parent; slot subjects see the same list.
 *
 * @see ../../../docs/spec/composition.md (CMP-7, EXP-4 argument recipe)
 * @see ../../../docs/spec/tracking.md (EXP-2 encoding selection: MDS1 snapshot transport)
 */
import { describe, expect, test } from '@jest/globals';
import { encodeSnapshot } from '@microdelta/value';

import { derivedArguments, type IInvocationArguments } from '../src/index.js';

describe('derivedArguments', () => {
  test('decodes derived recipes by position and leaves forwarded and unreconstructible positions as holes', () => {
    const recipes: IInvocationArguments = [
      { form: 'derived', value: encodeSnapshot(101), justified: true },
      { form: 'forwarded', origin: { binding: 'child', call: 0, path: [{ kind: 'index', index: 0 }] } },
      { form: 'derived', value: encodeSnapshot({ label: 'docs', weights: [2, 1] }), justified: false },
      { form: 'unreconstructible', reason: 'function' },
    ];
    const derived = derivedArguments(recipes);
    expect(derived).toHaveLength(4);
    expect(derived[0]).toBe(101);
    expect(1 in derived).toBe(false);
    expect(derived[2]).toEqual({ label: 'docs', weights: [2, 1] });
    expect(3 in derived).toBe(false);
    // Justification is not Definition's judgment: an unjustified value still decodes.
    expect(Object.isFrozen(derived)).toBe(true);
    expect(Object.isFrozen(derived[2])).toBe(true);
  });

  test('a derived undefined is a present position, distinct from a hole', () => {
    const derived = derivedArguments([{ form: 'derived', value: encodeSnapshot(undefined), justified: true }]);
    expect(0 in derived).toBe(true);
    expect(derived[0]).toBeUndefined();
  });

  test('the explicit empty form yields an empty list', () => {
    expect(derivedArguments({ form: 'empty' })).toEqual([]);
  });

  test('a non-canonical recorded value is rejected rather than guessed', () => {
    expect(() => derivedArguments([{ form: 'derived', value: 'not an encoding', justified: true }])).toThrow(/canonical MDS1/u);
  });
});
