/**
 * Author error text never becomes framework text (RUN-013). When an author
 * callback Resolution runs throws (a memo body, a source check, a finality
 * hook) or a caller-supplied port it consults throws (admission, a lifecycle
 * observer), Resolution's typed failure names the step and the failure kind
 * only. The thrown error stays available, unchanged, as the failure's
 * `cause`; it never reaches the failure's message, a lifecycle event, an
 * outcome diagnostic or History's stored records.
 *
 * Every such error the fixture throws carries {@link authorSecret}.
 *
 * @see ../../../../docs/spec/operations.md (RUN-013 owner decision: diagnostics name fields and keys, not their contents)
 * @see ../../../../docs/spec/execution.md (REUSE-009)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { ResolutionError } from '@microdelta/resolution';

import { cleanup, freshLocation } from '../durable-history/support.js';
import { authorSecret, resetWorld, world } from './fixture.js';
import { openSession, referenceOf } from './support.js';
import type { IAdmissionPlan, IObserverPlan, ISession } from './support.js';

beforeEach(() => {
  resetWorld();
});
afterEach(cleanup);

/** Run one session around `body`. */
async function withSession<T>(location: string, body: (session: ISession) => Promise<T>, plans: { readonly admission?: IAdmissionPlan; readonly observer?: IObserverPlan } = {}): Promise<T> {
  const session = openSession(location, {}, plans);
  try {
    return await body(session);
  } finally {
    session.close();
  }
}

/** The failure a promise rejects with; anything else fails the test. */
async function failureOf(promise: Promise<unknown>): Promise<ResolutionError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ResolutionError) {
      return error;
    }
    throw new Error(`expected a ResolutionError, observed ${String(error)}`);
  }
  throw new Error('expected a ResolutionError, but the request succeeded');
}

/** Whether any file of the store at `location` (database, journal or WAL) contains `text`. */
function storeContains(location: string, text: string): boolean {
  const directory = dirname(location);
  return readdirSync(directory).some((name) => readFileSync(join(directory, name)).includes(text));
}

/** Publish Ada's activity cold, so a later session validates it. */
async function coldAda(location: string): Promise<void> {
  await withSession(location, async (session) => {
    referenceOf(await session.resolve(session.contributors.steps['person:ada'].activity));
  });
}

/** One way an author callback or caller port throws, and the typed failure it becomes. */
interface IThrowingCase {
  readonly label: string;
  readonly code: ResolutionError['code'];
  readonly step: 'activity' | 'summary';
  /** Arrange the world (and any earlier sessions) before the failing request. */
  readonly arrange: (location: string) => Promise<void>;
  readonly plans?: { readonly admission?: IAdmissionPlan; readonly observer?: IObserverPlan };
}

const cases: readonly IThrowingCase[] = [
  {
    label: 'a memo body',
    code: 'execution-failure',
    step: 'summary',
    arrange: () => {
      world.summaryThrows['person:ada'] = true;
      return Promise.resolve();
    },
  },
  {
    label: 'a source check',
    code: 'execution-failure',
    step: 'activity',
    arrange: async (location) => {
      await coldAda(location);
      world.finality['person:ada'] = 'not-final';
      world.check['person:ada'] = 'throw';
    },
  },
  {
    label: 'a finality hook',
    code: 'policy-failure',
    step: 'activity',
    arrange: async (location) => {
      await coldAda(location);
      world.finality['person:ada'] = 'throw';
    },
  },
  {
    label: 'the admission port',
    code: 'admission-failure',
    step: 'activity',
    arrange: () => Promise.resolve(),
    plans: { admission: { fail: true } },
  },
  {
    label: 'a lifecycle observer before execution',
    code: 'observer-failure',
    step: 'activity',
    arrange: () => Promise.resolve(),
    plans: { observer: { throwAt: 'verify' } },
  },
];

describe('author error text stays in the cause (RUN-013)', () => {
  test.each(cases)('$label that throws fails with $code naming the step only; its error is the cause, and no event, diagnostic or stored record repeats it', async ({ code, step, arrange, plans }) => {
    const location = freshLocation();
    await arrange(location);
    await withSession(location, async (session) => {
      const failure = await failureOf(session.resolve(session.contributors.steps['person:ada'][step]));
      expect(failure.code).toBe(code);
      expect(failure.message).toContain('person:ada');
      expect(failure.message).not.toContain(authorSecret);
      // The author's error itself is preserved for the caller, unchanged.
      expect(failure.cause instanceof Error ? failure.cause.message : undefined).toContain(authorSecret);
      expect(JSON.stringify(session.events)).not.toContain(authorSecret);
    }, plans);
    expect(storeContains(location, authorSecret)).toBe(false);
  });

  test('an observer failure after publication commits is a diagnostic naming the phase and step, without the observer\'s error text', async () => {
    const location = freshLocation();
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].activity);
      expect(outcome.kind).toBe('published');
      expect(outcome.diagnostics).toEqual([expect.stringContaining('publish')]);
      expect(outcome.diagnostics.join('\n')).toContain('person:ada');
      expect(outcome.diagnostics.join('\n')).not.toContain(authorSecret);
    }, { observer: { throwAt: 'publish' } });
  });
});
