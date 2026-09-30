/**
 * EXP-8 restart and fault-point outcomes (TEST-2). Every stage is a separate
 * Node process started by this suite; a killed stage is terminated with
 * SIGKILL at a named commit boundary or right after the fake provider applied
 * an effect. Later stages load only the store file and the provider's ledger
 * file. Expected outcomes are derived by hand from the owner decisions in
 * issue #109: the base run is `m-ok` (one `summarize`), `m-quota` (one
 * `assess`, rate-limited until T = T0 + 3h) and `m-cancel` (`fetch`, then
 * `generate` in flight, then `polish`); every successful response reports 100
 * tokens and every refused one reports 1 request.
 *
 * @see ../../../docs/spec/acceptance.md (TEST-2, A-12, A-13, A-14)
 * @see ../../../docs/spec/operations.md (RUN-011..RUN-015, ACC-003, ACC-005, ACC-007)
 * @see ../../../docs/spec/execution.md (PUB-004, PUB-006)
 */
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

import { parseState, summarizeUsage } from '../src/protocol.js';
import type { IDurableState } from '../src/protocol.js';
import { HOUR, T0, plantedValues, quotaAt, secrets } from './fakes.js';

/** The emitted driver; every stage runs it as its own OS process. */
const entry = fileURLToPath(new URL('./process-entry.js', import.meta.url));

/** Fixture directories live under the repository's ignored `scratch/`, never the system temp directory. */
const scratch = fileURLToPath(new URL('../../../../scratch/exp-8/', import.meta.url));

/** How a stage is expected to end. */
type IEnding = 'exits' | 'killed' | 'fails';

/** One stage's raw stdout, parsed; `undefined` when the process was killed before reporting. */
interface IStageRun {
  readonly report: unknown;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run one stage in a separate process and check how it ended. */
function stage(directory: string, scenario: string, name: 'A' | 'B' | 'C', ending: IEnding = 'exits'): IStageRun {
  const child = spawnSync(process.execPath, [entry, directory, scenario, name], { encoding: 'utf8' });
  if (ending === 'killed') {
    expect(child.signal).toBe('SIGKILL');
    return { report: undefined, stdout: child.stdout, stderr: child.stderr };
  }
  if (ending === 'fails') {
    expect(child.status).toBe(1);
    expect(child.stderr).toContain('presentation failed');
  } else {
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
  }
  const report: unknown = JSON.parse(child.stdout);
  return { report, stdout: child.stdout, stderr: child.stderr };
}

/** Read the store file exactly as a later process would. */
async function persisted(directory: string): Promise<IDurableState> {
  const parsed: unknown = JSON.parse(await readFile(path.join(directory, 'store.json'), 'utf8'));
  return parseState(parsed);
}

/** A scenario gets a fresh directory, removed afterwards. */
async function inDirectory<T>(work: (directory: string) => Promise<T>): Promise<T> {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'run-'));
  try {
    return await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Narrowing accessors over parsed reports (no casts). */
function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value ? Object.fromEntries(Object.entries(value))[key] : undefined;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value.map((item: unknown) => item) : [];
}

/** Events of one kind (and member) from a parsed report. */
function events(report: unknown, kind: string, member?: string): readonly unknown[] {
  return list(field(report, 'events')).filter(event => field(event, 'kind') === kind && (member === undefined || field(event, 'member') === member));
}

/** Requests the provider received, by name. */
function received(report: unknown, name: string): readonly unknown[] {
  return list(field(field(report, 'provider'), 'received')).filter(request => field(request, 'name') === name);
}

/** The one request attempt record for a member and operation name in a persisted store. */
function requestsOf(state: IDurableState, member: string, name: string): readonly { readonly id: string; readonly state: string; readonly operationId: string }[] {
  return Object.entries(state.requests)
    .filter(([, request]) => request.member === member && state.operations[request.operationId]?.name === name)
    .map(([id, request]) => ({ id, state: request.state, operationId: request.operationId }));
}

describe('Criterion 3 and 6: long quota wait across processes (exit mode)', () => {
  test('A defers and exits waiting until T; B before T admits nothing for it; C after T retries the same operation and reuses siblings', async () => {
    await inDirectory(async directory => {
      const a = stage(directory, 'quota-exit', 'A').report;
      expect(a).toMatchObject({
        status: 'waiting',
        waitingUntil: quotaAt,
        members: {
          'm-ok': { status: 'published' },
          'm-quota': { status: 'waiting', notBefore: quotaAt },
          'm-cancel': { status: 'interrupted' },
        },
        provider: { calls: { summarize: 1, assess: 1, fetch: 1, generate: 1 } },
      });
      expect(events(a, 'remote-state', 'm-cancel')).toEqual([expect.objectContaining({ status: 'cancelled' })]);
      const afterA = await persisted(directory);
      expect(afterA.lease.holder).toBeNull();
      const [deferred] = requestsOf(afterA, 'm-quota', 'assess');
      expect(afterA.operations[deferred?.operationId ?? '']).toMatchObject({ state: 'deferred', notBefore: quotaAt });
      const okReference = afterA.results['m-ok']?.reference;

      const b = stage(directory, 'quota-exit', 'B').report;
      expect(b).toMatchObject({
        status: 'waiting',
        waitingUntil: quotaAt,
        members: {
          'm-ok': { status: 'reused', reference: okReference },
          'm-quota': { status: 'waiting', notBefore: quotaAt },
          'm-cancel': { status: 'published' },
        },
        provider: { calls: { summarize: 1, assess: 1, fetch: 2, generate: 2, polish: 1 } },
      });
      // Before T the deferred member is only reported waiting: no admission, request or fake progress.
      expect(list(field(b, 'events')).filter(event => field(event, 'member') === 'm-quota').map(event => field(event, 'kind'))).toEqual(['member-waiting']);

      const c = stage(directory, 'quota-exit', 'C').report;
      expect(c).toMatchObject({
        status: 'settled',
        waitingUntil: null,
        members: {
          'm-ok': { status: 'reused', reference: okReference },
          'm-quota': { status: 'published' },
          'm-cancel': { status: 'reused' },
        },
        provider: { calls: { summarize: 1, assess: 2, fetch: 2, generate: 2, polish: 1 } },
      });
      const [first, retry] = received(c, 'assess');
      expect(field(retry, 'operationId')).toBe(deferred?.operationId);
      expect(field(first, 'operationId')).toBe(deferred?.operationId);
      expect(field(retry, 'requestAttemptId')).not.toBe(deferred?.id);
      expect(field(retry, 'at')).toBeGreaterThanOrEqual(quotaAt);
      // Criterion 6 across processes: same operation, new attempt, member and a different run.
      const started = events(c, 'request-started', 'm-quota');
      expect(started).toEqual([expect.objectContaining({ operationId: deferred?.operationId, requestAttemptId: field(retry, 'requestAttemptId'), member: 'm-quota', runId: field(c, 'runId') })]);
      expect(field(c, 'runId')).not.toBe(field(a, 'runId'));
      expect(events(c, 'retry-started', 'm-quota')).toEqual([expect.objectContaining({ operationId: deferred?.operationId })]);
      // Hand-derived totals: tokens = summarize 100 + fetch 2x100 + generate 100 + polish 100 + assess 100; one refused request.
      expect(field(c, 'usage')).toMatchObject({ known: { tokens: 600, requests: 1 } });
      const cancelledGenerate = requestsOf(await persisted(directory), 'm-cancel', 'generate').find(request => request.state === 'cancelled');
      expect(field(field(c, 'usage'), 'unknownRequests')).toEqual([cancelledGenerate?.id]);
    });
  });

  test('counterexample (no request checkpoint): re-running the cancelled member pays its completed first request again', async () => {
    await inDirectory(async directory => {
      stage(directory, 'quota-exit', 'A');
      stage(directory, 'quota-exit', 'B');
      const fetches = requestsOf(await persisted(directory), 'm-cancel', 'fetch');
      expect(fetches).toHaveLength(2);
      expect(fetches[0]?.operationId).not.toBe(fetches[1]?.operationId);
      expect(fetches.map(request => request.state)).toEqual(['succeeded', 'succeeded']);
    });
  });
});

describe('Criterion 3: sleep mode across a real lease probe', () => {
  test('the sleeping process holds no lease: another process takes and returns it; the run resumes after T with the same operation', async () => {
    await inDirectory(async directory => {
      const a = stage(directory, 'quota-sleep', 'A').report;
      expect(a).toMatchObject({
        status: 'settled',
        sleeps: [quotaAt],
        probes: [{ holderBefore: null, status: 'acquired', fence: 2 }],
        members: { 'm-ok': { status: 'published' }, 'm-quota': { status: 'published' } },
        provider: { calls: { summarize: 1, assess: 2 } },
      });
      expect(events(a, 'lease-acquired').map(event => field(event, 'fence'))).toEqual([1, 3]);
      const [first, retry] = received(a, 'assess');
      expect(field(retry, 'operationId')).toBe(field(first, 'operationId'));
      expect(field(retry, 'at')).toBeGreaterThanOrEqual(quotaAt);
    });
  });
});

describe('Criterion 1: stop across processes', () => {
  test('soft then hard: in-flight work aborts with unknown remote state; the later run blocks replay of the unresolved operation', async () => {
    await inDirectory(async directory => {
      const a = stage(directory, 'soft-then-hard', 'A').report;
      expect(a).toMatchObject({
        status: 'stopped',
        members: { 'm-ok': { status: 'published' }, 'm-quota': { status: 'waiting', notBefore: quotaAt }, 'm-cancel': { status: 'interrupted' } },
      });
      expect(events(a, 'stop-requested').map(event => field(event, 'level'))).toEqual(['soft', 'hard']);
      expect(events(a, 'remote-cancel-requested')).toEqual([]);
      expect(events(a, 'remote-state', 'm-cancel')).toEqual([expect.objectContaining({ status: 'unknown' })]);
      const afterA = await persisted(directory);
      const [generate] = requestsOf(afterA, 'm-cancel', 'generate');
      expect(generate?.state).toBe('unknown');
      expect(Object.values(afterA.attempts).filter(attempt => attempt.member === 'm-cancel').map(attempt => attempt.state)).toEqual(['interrupted']);
      expect(afterA.results['m-cancel']).toBeUndefined();

      const b = stage(directory, 'soft-then-hard', 'B').report;
      expect(b).toMatchObject({
        members: {
          'm-ok': { status: 'reused' },
          'm-quota': { status: 'waiting', notBefore: quotaAt },
          'm-cancel': { status: 'unknown-outcome', operationId: generate?.operationId },
        },
        provider: { calls: { summarize: 1, assess: 1, fetch: 1, generate: 1 } },
      });
    });
  });

  test('soft drain: the in-flight step publishes, the deferred retry never starts, and a later run reuses the drained result', async () => {
    await inDirectory(async directory => {
      const a = stage(directory, 'soft-drain', 'A').report;
      expect(a).toMatchObject({
        status: 'stopped',
        members: { 'm-ok': { status: 'published' }, 'm-quota': { status: 'waiting', notBefore: quotaAt }, 'm-cancel': { status: 'published' } },
        provider: { calls: { summarize: 1, assess: 1, fetch: 1, generate: 1, polish: 1 } },
      });
      expect(events(a, 'retry-started')).toEqual([]);
      const b = stage(directory, 'soft-drain', 'B').report;
      expect(b).toMatchObject({
        members: { 'm-ok': { status: 'reused' }, 'm-quota': { status: 'waiting' }, 'm-cancel': { status: 'reused' } },
        provider: { calls: { summarize: 1, assess: 1, fetch: 1, generate: 1, polish: 1 } },
      });
    });
  });
});

describe('Criterion 4 and 5: accounting and replay at every fault point (separate processes)', () => {
  test('killed after the intent, before sending: usage and outcome are unknown, never zero, and nothing replays', async () => {
    await inDirectory(async directory => {
      stage(directory, 'kill-after-intent', 'A', 'killed');
      const afterA = await persisted(directory);
      const [intent] = requestsOf(afterA, 'm-ok', 'summarize');
      expect(intent?.state).toBe('pending');
      // Read-only view of the crashed store before any writer recovers it: the dead intent is unknown, not live.
      expect(summarizeUsage(afterA, T0 + HOUR)).toMatchObject({ known: {}, unknownRequests: [intent?.id], pendingRequests: [] });
      const b = stage(directory, 'kill-after-intent', 'B').report;
      expect(b).toMatchObject({
        members: { 'm-ok': { status: 'unknown-outcome', operationId: intent?.operationId } },
        usage: { known: {}, unknownRequests: [intent?.id], pendingRequests: [] },
        provider: { calls: {} },
      });
      expect(events(b, 'recovered')).toEqual([expect.objectContaining({ requestAttemptId: intent?.id, status: 'unknown', reason: 'recovered-after-crash' })]);
      const afterB = await persisted(directory);
      expect(afterB.requests[intent?.id ?? '']?.state).toBe('unknown');
      expect(afterB.operations[intent?.operationId ?? '']?.state).toBe('unknown');
      expect(Object.values(afterB.attempts).map(attempt => attempt.state)).toEqual(['interrupted']);
    });
  });

  test('counterexample (pessimistic intent): a request that was never sent is indistinguishable from one that was, so the member stays blocked', async () => {
    await inDirectory(async directory => {
      stage(directory, 'kill-after-intent', 'A', 'killed');
      stage(directory, 'kill-after-intent', 'B');
      const c = stage(directory, 'kill-after-intent', 'B').report;
      expect(c).toMatchObject({ members: { 'm-ok': { status: 'unknown-outcome' } }, provider: { calls: {} } });
    });
  });

  test('killed after the provider applied the effect: unknown usage and outcome; the effect is not replayed', async () => {
    await inDirectory(async directory => {
      stage(directory, 'kill-after-send', 'A', 'killed');
      const b = stage(directory, 'kill-after-send', 'B').report;
      const [request] = requestsOf(await persisted(directory), 'm-ok', 'summarize');
      expect(b).toMatchObject({
        members: { 'm-ok': { status: 'unknown-outcome' } },
        usage: { known: {}, unknownRequests: [request?.id] },
        provider: { calls: { summarize: 1 }, applied: [expect.objectContaining({ name: 'summarize' })] },
      });
    });
  });

  test('killed after the usage acknowledgment (acknowledgment lost): usage is retained exactly once', async () => {
    await inDirectory(async directory => {
      stage(directory, 'kill-after-usage', 'A', 'killed');
      const b = stage(directory, 'kill-after-usage', 'B').report;
      const state = await persisted(directory);
      expect(Object.keys(state.usage)).toHaveLength(1);
      expect(b).toMatchObject({
        members: { 'm-ok': { status: 'unknown-outcome' } },
        usage: { known: { tokens: 100 }, unknownRequests: [] },
        provider: { calls: { summarize: 1 } },
      });
    });
  });

  test('killed just before the publication commit: the old complete state (no result); the next run re-executes as a distinct operation', async () => {
    await inDirectory(async directory => {
      stage(directory, 'kill-before-publication', 'A', 'killed');
      const afterA = await persisted(directory);
      expect(afterA.results).toEqual({});
      const [first] = requestsOf(afterA, 'm-ok', 'summarize');
      expect(first?.state).toBe('succeeded');
      const b = stage(directory, 'kill-before-publication', 'B').report;
      expect(b).toMatchObject({
        members: { 'm-ok': { status: 'published' } },
        usage: { known: { tokens: 200 } },
        provider: { calls: { summarize: 2 } },
      });
      const afterB = await persisted(directory);
      expect(Object.values(afterB.attempts).map(attempt => attempt.state)).toEqual(['interrupted', 'completed']);
      const operations = requestsOf(afterB, 'm-ok', 'summarize').map(request => request.operationId);
      expect(new Set(operations).size).toBe(2);
    });
  });

  test('killed just after the publication commit: the committed success is reused, never re-executed', async () => {
    await inDirectory(async directory => {
      stage(directory, 'kill-after-publication', 'A', 'killed');
      const afterA = await persisted(directory);
      const reference = afterA.results['m-ok']?.reference;
      expect(reference).toMatch(/^result-/u);
      const b = stage(directory, 'kill-after-publication', 'B').report;
      expect(b).toMatchObject({ members: { 'm-ok': { status: 'reused', reference } }, provider: { calls: { summarize: 1 } } });
      expect(Object.values((await persisted(directory)).attempts).map(attempt => attempt.state)).toEqual(['completed']);
    });
  });

  test('a throwing observer and a failing presenter after commit: the next process reuses the result', async () => {
    await inDirectory(async directory => {
      const a = stage(directory, 'observer-presenter-throw', 'A', 'fails').report;
      expect(a).toMatchObject({ members: { 'm-ok': { status: 'published' } } });
      expect(list(field(a, 'diagnostics')).every(diagnostic => field(diagnostic, 'code') === 'observer-failed')).toBe(true);
      const b = stage(directory, 'observer-presenter-throw', 'B').report;
      expect(b).toMatchObject({ members: { 'm-ok': { status: 'reused' } }, provider: { calls: { summarize: 1 } } });
    });
  });

  test('a duplicate report delivered to a later process counts once', async () => {
    await inDirectory(async directory => {
      const a = stage(directory, 'duplicate-delivery', 'A').report;
      expect(events(a, 'usage-acknowledged').map(event => field(event, 'status'))).toEqual(['acknowledged']);
      const b = stage(directory, 'duplicate-delivery', 'B').report;
      expect(events(b, 'usage-acknowledged').map(event => field(event, 'status'))).toEqual(['duplicate']);
      expect(b).toMatchObject({ usage: { known: { tokens: 100 } } });
      expect(Object.keys((await persisted(directory)).usage)).toHaveLength(1);
    });
  });

  test('a lost response on a non-idempotent mutation stays unknown across processes: no replay', async () => {
    await inDirectory(async directory => {
      const a = stage(directory, 'lost-response-mutation', 'A').report;
      expect(a).toMatchObject({ members: { 'm-ok': { status: 'unknown-outcome' } }, provider: { calls: { summarize: 1 } } });
      const b = stage(directory, 'lost-response-mutation', 'B').report;
      expect(b).toMatchObject({ members: { 'm-ok': { status: 'unknown-outcome' } }, provider: { calls: { summarize: 1 } } });
      expect(events(b, 'member-blocked', 'm-ok')).toEqual([expect.objectContaining({ reason: 'not-repeat-safe' })]);
    });
  });

  test.each([
    ['safe-repeat-after-send', 2],
    ['idempotent-after-send', 1],
  ])('%s: the recovered operation retries in a new process with the same operation ID (%i applied effects)', async (scenario, effects) => {
    await inDirectory(async directory => {
      stage(directory, scenario, 'A', 'killed');
      const afterA = await persisted(directory);
      const [first] = requestsOf(afterA, 'm-ok', 'summarize');
      const runA = Object.values(afterA.attempts)[0]?.runId;
      const b = stage(directory, scenario, 'B').report;
      expect(b).toMatchObject({ members: { 'm-ok': { status: 'published' } }, provider: { calls: { summarize: 2 } } });
      expect(list(field(field(b, 'provider'), 'applied'))).toHaveLength(effects);
      const started = events(b, 'request-started', 'm-ok');
      expect(started).toEqual([expect.objectContaining({ operationId: first?.operationId, member: 'm-ok', runId: field(b, 'runId') })]);
      expect(field(started[0], 'requestAttemptId')).not.toBe(first?.id);
      expect(field(b, 'runId')).not.toBe(runA);
      expect(events(b, 'retry-started', 'm-ok')).toEqual([expect.objectContaining({ operationId: first?.operationId })]);
    });
  });
});

describe('Criterion 7 across processes', () => {
  test('no stage output of any scenario contains a planted value, while the store retains them', async () => {
    const outputs: string[] = [];
    let storeText = '';
    for (const [scenario, stages] of [
      ['quota-exit', ['A', 'B', 'C']],
      ['soft-then-hard', ['A', 'B']],
      ['lost-response-mutation', ['A', 'B']],
      ['observer-presenter-throw', ['A', 'B']],
    ] as const) {
      await inDirectory(async directory => {
        for (const name of stages) {
          const run = stage(directory, scenario, name, scenario === 'observer-presenter-throw' && name === 'A' ? 'fails' : 'exits');
          outputs.push(run.stdout, run.stderr);
        }
        storeText += await readFile(path.join(directory, 'store.json'), 'utf8');
      });
    }
    for (const value of plantedValues) {
      expect(outputs.join('\n')).not.toContain(value);
    }
    expect(storeText).toContain(secrets.output);
    expect(storeText).toContain(secrets.input);
  });
});
