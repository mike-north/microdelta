/**
 * Reuse Resolution resolves template instances but still refuses strict
 * folds: a fold step is refused with `invalid-request` before any evidence,
 * candidate lookup or admission, and without running any author callback;
 * strict fold readiness belongs to later Resolution work. A template-bearing
 * descriptor that names no composed template step is an ordinary unbound
 * step, and malformed template fields are rejected as a malformed request
 * without running the caller's accessors.
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

/** The Resolution code of a caught failure, if it is one. */
function codeOf(caught: unknown): string | undefined {
  return caught instanceof ResolutionError ? caught.code : undefined;
}

describe('Resolution refuses steps it does not resolve (CMP-9)', () => {
  test('a strict fold step is refused with invalid-request before evidence, candidate lookup or admission', async () => {
    const observed = await refusal(({ fold }) => fold);
    expect(observed.caught).toBeInstanceOf(ResolutionError);
    expect(codeOf(observed.caught)).toBe('invalid-request');
    expect(observed.caught instanceof ResolutionError ? observed.caught.message : '').toContain('strict fold');
    expect(observed.events).toEqual([]);
    expect(observed.admissions).toEqual([]);
    expect(observed.statements.statements).toBe(0);
  });

  test('a template-bearing descriptor naming no composed template step is an unbound step, with no evidence or admission', async () => {
    for (const step of [
      ({ instance }: { readonly instance: IBindingDescriptor }) => ({ ...instance, template: 'renamed' }),
      ({ instance }: { readonly instance: IBindingDescriptor }) => ({ ...instance, collection: 'roster' }),
      ({ instance }: { readonly instance: IBindingDescriptor }) => ({ ...instance, slot: 'undeclared' }),
    ]) {
      const observed = await refusal(step);
      expect(codeOf(observed.caught)).toBe('unbound-step');
      expect(observed.events).toEqual([]);
      expect(observed.admissions).toEqual([]);
      expect(observed.statements.statements).toBe(0);
    }
  });

  test('malformed template fields are an invalid request, and the requested descriptor\'s accessors never run', async () => {
    let reads = 0;
    const cases: readonly ((descriptors: { readonly instance: IBindingDescriptor }) => IBindingDescriptor)[] = [
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
      expect(codeOf(observed.caught)).toBe('invalid-request');
      expect(observed.caught instanceof ResolutionError ? observed.caught.message : '').toContain('Malformed step descriptor');
      expect(observed.events).toEqual([]);
      expect(observed.admissions).toEqual([]);
    }
    expect(reads).toBe(0);
  });
});
