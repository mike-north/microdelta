/**
 * Reuse Resolution resolves only explicit member and composition-level
 * sources and memos. A template instance step (a descriptor carrying
 * `template`/`collection`) and a strict fold are refused with
 * `invalid-request` before any evidence, candidate lookup or admission, and
 * without running any author callback. Template instance resolution and
 * strict fold readiness belong to later Resolution work.
 *
 * @see ../../../../docs/spec/composition.md (CMP-4, CMP-8, CMP-9)
 * @see ../../../../docs/plans/m4-composition.md (Implementation queue and readiness)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { ResolutionError } from '@microdelta/resolution';
import type { IBindingDescriptor } from '@microdelta/definition';

import { cleanup, freshLocation } from '../durable-history/support.js';
import { resetWorld } from './fixture.js';
import { openSession } from './support.js';

beforeEach(() => {
  resetWorld();
});
afterEach(cleanup);

/** Resolve `step` in a fresh keyed session and return the failure plus what the session observed. */
async function refusal(step: (descriptors: { readonly instance: IBindingDescriptor; readonly fold: IBindingDescriptor }) => IBindingDescriptor) {
  const session = openSession(freshLocation(), { keyed: true });
  try {
    const start = session.sqlite.mark();
    let caught: unknown;
    try {
      await session.resolve(step(session.contributors.keyed));
    } catch (error: unknown) {
      caught = error;
    }
    return { caught, statements: session.sqlite.evidence(start), admissions: [...session.admissions], events: [...session.events] };
  } finally {
    session.close();
  }
}

describe('Resolution refuses steps it does not resolve (CMP-9)', () => {
  test('a bound template instance step is refused with invalid-request before evidence, candidate lookup or admission', async () => {
    const observed = await refusal(({ instance }) => instance);
    expect(observed.caught).toBeInstanceOf(ResolutionError);
    expect(observed.caught instanceof ResolutionError ? observed.caught.code : undefined).toBe('invalid-request');
    expect(observed.events).toEqual([]);
    expect(observed.admissions).toEqual([]);
    expect(observed.statements.statements).toBe(0);
  });

  test('a template-bearing descriptor that binds nothing is refused the same way, not reported as an unbound member step', async () => {
    const observed = await refusal(({ instance }) => ({ ...instance, template: 'renamed' }));
    expect(observed.caught instanceof ResolutionError ? observed.caught.code : undefined).toBe('invalid-request');
    expect(observed.events).toEqual([]);
  });

  test('the refusal reads the requested descriptor before any composition lookup, never running its accessors', async () => {
    let reads = 0;
    const cases: readonly ((descriptors: { readonly instance: IBindingDescriptor }) => IBindingDescriptor)[] = [
      // Malformed template fields would fail composition lookup; the refusal comes first.
      ({ instance }) => ({ ...instance, template: '' }),
      ({ instance }) => ({ scope: instance.scope, role: 'step', slot: 'summary', collection: 'contributors', memberKey: 'person:ada' }),
      ({ instance }) => Object.defineProperty({ ...instance }, 'template', {
        get: () => {
          reads++;
          return 'contributor';
        },
        enumerable: true,
      }),
    ];
    for (const step of cases) {
      const observed = await refusal(step);
      expect(observed.caught instanceof ResolutionError ? observed.caught.code : undefined).toBe('invalid-request');
      expect(observed.caught instanceof ResolutionError ? observed.caught.message : '').toContain('template instance step');
      expect(observed.events).toEqual([]);
    }
    expect(reads).toBe(0);
  });

  test('a strict fold step is refused with invalid-request before evidence, candidate lookup or admission', async () => {
    const observed = await refusal(({ fold }) => fold);
    expect(observed.caught).toBeInstanceOf(ResolutionError);
    expect(observed.caught instanceof ResolutionError ? observed.caught.code : undefined).toBe('invalid-request');
    expect(observed.events).toEqual([]);
    expect(observed.admissions).toEqual([]);
    expect(observed.statements.statements).toBe(0);
  });
});
