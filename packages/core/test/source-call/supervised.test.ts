/** SCD-6/criterion10: callable sources keep real intent, retry, stop, usage and writer-fence gates. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { faultySqlite } from '../accounting/support.js';
import { cleanup } from '../durable-history/support.js';
import { until } from '../operations/harness.js';
import { attemptsAt, deferred, publishedSubjects } from '../stop/support.js';
import { createWorld, installSearchBarrier, installWorld, scope } from './fixture.js';
import type { IWorld } from './fixture.js';
import { session } from './supervised-support.js';
import type { ISession } from './supervised-support.js';

let directory: string;
let active: ISession | undefined;
let world: IWorld;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'microdelta-supervised-source-')); world = createWorld(); installWorld(world); });
afterEach(() => { installSearchBarrier(undefined); active?.close(); cleanup(); rmSync(directory, { recursive: true, force: true }); });
/** Open once per test, keeping every real authority available for boundary assertions. */
function open(options: Parameters<typeof session>[1] = {}): ISession { active = session(directory, options); return active; }
/** Provider sends are separate from source attempts, finality checks and author summaries. */
function received(session: ISession, id: string) { return session.provider.ledger().filter(entry => entry.kind === 'received' && entry.key === id); }
/** The current source result can only exist after its supervised operation completed. */
function candidates(session: ISession, subject: string) { return session.history.findCandidates({ analysis: scope, environment: 'production', subject, version: 1 }); }

describe('supervised callable source acquisition', () => {
  test('confirmed operation and usage intent precede send, call identities stay separate, and an independent person settles during a detail wait', async () => {
    const current = open();
    current.provider.script('detail', 'repo#101', ['hang']);
    const started = current.start();
    await until(() => received(current, 'repo#101').length === 1 && world.trace.includes('summary:grace'), 'detail 101 is pending while Grace settles');
    const [send] = received(current, 'repo#101');
    expect(send).toBeDefined();
    expect(current.contents()).toContainEqual(expect.objectContaining({ operation: send?.operation, subject: 'detail:repo#101', status: 'pending', attempts: [expect.objectContaining({ requestAttempt: send?.requestAttempt, status: 'pending', intent: null })] }));
    expect(current.accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'incomplete', unknown: expect.arrayContaining([expect.objectContaining({ operation: send?.operation, requestAttempt: send?.requestAttempt })]) });
    expect(candidates(current, 'detail:repo#101')).toEqual([]);
    expect(candidates(current, 'summary:ada')).toEqual([]);
    expect(candidates(current, 'summary:grace')).toHaveLength(1);
    current.provider.release('detail', 'repo#101');
    const result = await started.done;
    expect(result.value.report.outcome.status).toBe('succeeded');
    expect(result.value.operations.map(operation => operation.subject.subject).sort()).toEqual(['detail:repo#101', 'detail:repo#102', 'detail:repo#201']);
    expect(new Set(result.value.operations.map(operation => operation.operation)).size).toBe(3);
    expect(new Set(result.value.operations.flatMap(operation => operation.attempts.map(attempt => attempt.stepAttempt))).size).toBe(3);
    expect(current.accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'complete', requestAttempts: 3, reports: 3, observed: [{ unit: 'tokens', amount: 300 }] });
  });

  test('an unconfirmed Accounting intent sends nothing and leaves the required source/person pending', async () => {
    const faulty = faultySqlite();
    const current = open({ accountingSqlite: faulty.capability });
    faulty.arm({ role: 'intent', timing: 'before-commit', action: 'throw' });
    const result = await current.start().done;
    expect(received(current, 'repo#101')).toEqual([]);
    expect(result.value.report.members.map(member => [member.key, member.status])).toEqual([['ada', 'pending'], ['grace', 'succeeded']]);
    expect(result.value.report.outcome.status).toBe('waiting');
    expect(candidates(current, 'detail:repo#101')).toEqual([]);
    expect(candidates(current, 'summary:ada')).toEqual([]);
    expect(current.contents()).toContainEqual(expect.objectContaining({ subject: 'detail:repo#101', status: 'deferred', attempts: [expect.objectContaining({ status: 'not-sent', intent: 'unconfirmed' })] }));
    expect(attemptsAt(current.location)).toContainEqual(expect.objectContaining({ subject: 'detail:repo#101', state: 'interrupted', ending: 'unsettled' }));
  });

  test('lost response preserves unknown usage and strict pending, while a new run gets finite acquisition allowance', async () => {
    const current = open();
    current.provider.script('detail', 'repo#101', ['lost']);
    const first = await current.start().done;
    expect(first.value.report.outcome.status).toBe('waiting');
    expect(first.value.report.members.map(member => [member.key, member.status])).toEqual([['ada', 'pending'], ['grace', 'succeeded']]);
    expect(candidates(current, 'summary:ada')).toEqual([]);
    expect(current.accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'incomplete', unknown: [expect.any(Object)], observed: [{ unit: 'tokens', amount: 100 }] });
    const operation = received(current, 'repo#101')[0]?.operation;
    world = { ...world, accepts: { 'repo#201': true }, trace: [] }; installWorld(world);
    const resumed = await current.start().done;
    expect(resumed.value.report.outcome.status).toBe('succeeded');
    expect(received(current, 'repo#101').map(send => send.operation)).toEqual([operation, operation]);
    expect(received(current, 'repo#101').map(send => send.requestAttempt)).toHaveLength(2);
    expect(current.accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'incomplete', reports: 3, observed: [{ unit: 'tokens', amount: 300 }], unknown: [expect.any(Object)] });
  });

  test('a transient detail retry waits on the controlled clock without holding independent person completion', async () => {
    const current = open();
    current.provider.script('detail', 'repo#101', ['transient', 'ok']);
    world = { ...world, accepts: { 'repo#201': true } }; installWorld(world);
    const started = current.start({ deferral: 'sleep', maxAttempts: 2, backoffMilliseconds: 10 });
    await until(() => world.trace.includes('summary:grace') && current.timer.pending().includes(current.timer.currentEpochMilliseconds() + 10), 'Grace settles while Ada waits for retry');
    expect(candidates(current, 'summary:ada')).toEqual([]);
    expect(received(current, 'repo#101')).toHaveLength(1);
    current.timer.advanceTo(current.timer.currentEpochMilliseconds() + 10);
    const result = await started.done;
    expect(result.value.report.outcome.status).toBe('succeeded');
    const sent = received(current, 'repo#101');
    expect(sent).toHaveLength(2);
    expect(sent[0]?.operation).toBe(sent[1]?.operation);
    expect(sent[0]?.requestAttempt).not.toBe(sent[1]?.requestAttempt);
    expect(current.accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'complete', observed: [{ unit: 'requests', amount: 1 }, { unit: 'tokens', amount: 300 }] });
  });

  test('hard stop at dispatch prevents provider send and records interrupted source attempts', async () => {
    const current = open();
    const stop = current.stop();
    const result = await current.start({ stop, observe: event => { if (event.kind === 'send' && event.phase === 'begin' && event.label === 'detail') { stop.request({ level: 'hard' }); } } }).done;
    expect(current.provider.ledger().filter(entry => entry.kind === 'received')).toEqual([]);
    expect(result.value.report.outcome.status).toBe('failed');
    expect(publishedSubjects(current.location)).not.toContain('summary:ada');
    expect(attemptsAt(current.location)).toContainEqual(expect.objectContaining({ subject: 'detail:repo#101', state: 'interrupted', ending: 'stopped' }));
  });

  test('hard stop during required detail preserves a completed independent person for the next run', async () => {
    const current = open();
    const stop = current.stop();
    current.provider.script('detail', 'repo#101', ['hang']);
    const started = current.start({ stop });
    await until(() => received(current, 'repo#101').length === 1 && world.trace.includes('summary:grace'), 'Grace completes during the required detail wait');
    const grace = candidates(current, 'summary:grace')[0]?.reference;
    stop.request({ level: 'hard' });
    const stopped = await started.done;
    expect(stopped.value.report.outcome.status).toBe('failed');
    expect(candidates(current, 'summary:ada')).toEqual([]);
    expect(received(current, 'repo#102')).toEqual([]);
    expect(attemptsAt(current.location)).toContainEqual(expect.objectContaining({ subject: 'detail:repo#101', state: 'interrupted', ending: 'stopped' }));
    world = { ...world, accepts: { 'repo#201': true }, trace: [] }; installWorld(world);
    const resumed = await current.start().done;
    expect(resumed.value.report.outcome.status).toBe('succeeded');
    expect(candidates(current, 'summary:grace')[0]?.reference).toEqual(grace);
    expect(world.trace.filter(event => event.startsWith('summary:'))).toEqual(['summary:ada']);
  });

  test('a successor writer fences a late source response before source or person publication', async () => {
    const current = open({ leaseMilliseconds: 100 });
    current.provider.script('detail', 'repo#101', ['hang']);
    const started = current.start();
    await until(() => received(current, 'repo#101').length === 1 && world.trace.includes('summary:grace'), 'the source is in flight before lease loss');
    const held = current.history.currentWriter();
    if (held === undefined) { throw new Error('An in-flight source must hold the writer lease'); }
    const before = attemptsAt(current.location).find(attempt => attempt.subject === 'detail:repo#101');
    current.timer.advanceTo(held.expiresAt);
    const successor = current.history.acquireWriter({ holder: 'successor', leaseMilliseconds: 60_000 });
    expect(successor.kind).toBe('acquired');
    current.provider.release('detail', 'repo#101');
    const result = await started.done;
    expect(result.value.report.outcome.status).not.toBe('succeeded');
    expect(candidates(current, 'detail:repo#101')).toEqual([]);
    expect(candidates(current, 'summary:ada')).toEqual([]);
    expect(attemptsAt(current.location).find(attempt => attempt.subject === 'detail:repo#101')).toEqual(before);
    if (successor.kind === 'acquired') { current.history.releaseWriter(successor.lease); }
  });

  test('an unfinished search cannot certify empty success or admit details while another person settles', async () => {
    const barrier = deferred<void>();
    installSearchBarrier(person => person === 'ada' ? barrier.promise : Promise.resolve());
    const current = open();
    const started = current.start();
    let settled = false;
    void started.done.then(() => { settled = true; });
    await until(() => world.trace.includes('summary:grace'), 'Grace settles while Ada search is unfinished');
    expect(settled).toBe(false);
    expect(world.trace).not.toContain('search-complete:ada');
    expect(received(current, 'repo#101')).toEqual([]);
    expect(candidates(current, 'summary:ada')).toEqual([]);
    barrier.resolve();
    expect((await started.done).value.report.outcome.status).toBe('succeeded');
  });
});
