/** Independent watchdog regressions run only the inert fixture and at most one of its inert descendants. */
import { afterEach, expect, test } from '@jest/globals';
import { superviseCoordinator } from '../node/outer.js';
import type { IOuterOptions } from '../node/outer.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Small durations exist only in tests; actual launcher callers cannot enlarge the fixed production envelope. */
const policy = { campaignMilliseconds: 250, cleanupMilliseconds: 70, termMilliseconds: 70, outerMilliseconds: 1300 } as const;
/** Each regression owns one existing output directory; the helper never creates authority before preparation validates it. */
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
/** Fixture entrypoints are inert emitted JavaScript outside all actual qualification paths. */
const entrypoint = fileURLToPath(new URL('./outer-fixture.js', import.meta.url));
/** Every invocation starts its absolute clock before caller preparation. */
async function options(mode: string): Promise<IOuterOptions> {
    const output = await mkdtemp(join(tmpdir(), 'issue302-outer-'));
    roots.push(output);
    return { execPath: process.execPath, entrypoint, args: [mode, join(output, 'descendant.pid')], startedAt: Date.now(), output, policy };
}
/** PID existence checks target only an inert PID returned by this test's own fixture. */
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (cause) { if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ESRCH') { return false; } throw cause; } }

test('normal inert completion keeps actual code/signal, result, bounded output and explicit measurement closure', async () => {
    const value = await options('normal');
    const result = await superviseCoordinator(value);
    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.forced).toBe(false);
    expect(result.stdout).toContain('inert normal');
    expect(result.report).toEqual({ fixture: true, verdict: 'INCONCLUSIVE' });
    expect(result.unresolved).toMatchObject({ coordinator: false, group: false, workers: [], measurement: 'closed', preparation: false });
    const serialized = await readFile(join(typeof value.output === 'string' ? value.output : value.output(), 'outer-receipt.json'), 'utf8');
    const receipt: unknown = JSON.parse(serialized);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(448 * 1024);
    expect(receipt).toMatchObject({ code: 0, signal: null, outputEncoding: 'base64', stdoutBase64: Buffer.from('inert normal\n').toString('base64'), unresolved: { measurement: 'closed' } });
});

for (const mode of ['blocked', 'gap']) {
    test(`independent outer stops TERM-ignoring ${mode} coordinator and its process group before the full envelope`, async () => {
        const value = await options(mode);
        const result = await superviseCoordinator(value);
        const elapsed = Date.now() - value.startedAt;
        expect(elapsed).toBeLessThan(policy.outerMilliseconds);
        expect(result.forced).toBe(true);
        expect(result.signal).toBe('SIGKILL');
        const pid = Number(await readFile(join(typeof value.output === 'string' ? value.output : value.output(), 'descendant.pid'), 'utf8'));
        expect(alive(pid)).toBe(false);
        expect(result.unresolved.measurement).toBe('owned');
        if (mode === 'blocked') { expect(result.unresolved.workers).toHaveLength(1); }
    });
}

test('preparation delay consumes the campaign budget and cannot spawn after late preparation completion', async () => {
    const value = await options('normal');
    let completed = false;
    const result = await superviseCoordinator({ ...value, prepare: async () => { await new Promise(resolve => setTimeout(resolve, 450)); completed = true; } });
    expect(result.expired).toBe(true);
    expect(result.events.some(event => event.kind === 'coordinator-spawn')).toBe(false);
    expect(result.unresolved.preparation).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 160));
    expect(completed).toBe(true);
    expect(result.events.some(event => event.kind === 'coordinator-spawn')).toBe(false);
});

test('an already exhausted invocation refuses setup and coordinator spawn', async () => {
    const value = await options('normal');
    let prepared = false;
    const result = await superviseCoordinator({ ...value, startedAt: value.startedAt - policy.campaignMilliseconds - 10, prepare: async () => { prepared = true; } });
    expect(result.expired).toBe(true);
    expect(prepared).toBe(false);
    expect(result.events.some(event => event.kind === 'coordinator-spawn')).toBe(false);
});

test('early stage expiry cancels the coordinator and prevents a later otherwise runnable cell', async () => {
    const result = await superviseCoordinator(await options('expired'));
    expect(result.expired).toBe(true);
    expect(result.report).toEqual({ fixture: true, cancelled: true });
    expect(result.events.some(event => event.kind === 'observation' && typeof event.facts === 'object' && event.facts !== null && 'cell' in event.facts && event.facts.cell === 'later-cell-ran')).toBe(false);
    expect(result.unresolved.pendingStages).toContain('Q1.setup');
});

test('stalled measurement acquisition remains uncertain after forced coordinator termination', async () => {
    const result = await superviseCoordinator(await options('acquiring'));
    expect(result.forced).toBe(true);
    expect(result.unresolved.measurement).toBe('acquiring');
    expect(result.events.some(event => event.kind === 'measurement' && event.state === 'closed')).toBe(false);
});

test('received counterexample facts survive a forced exit and failed outer receipt persistence', async () => {
    const value = await options('counterexample');
    const result = await superviseCoordinator({ ...value, output: join(typeof value.output === 'string' ? value.output : value.output(), 'missing') });
    expect(result.events.some(event => event.kind === 'observation' && typeof event.facts === 'object' && event.facts !== null && 'outcome' in event.facts && event.facts.outcome === 'counterexample')).toBe(true);
    expect(result.persistenceFailures.some(failure => failure.includes('ENOENT'))).toBe(true);
    expect(result.unresolved.measurement).toBe('acquiring');
});

test('invalid IPC worker identity fails closed and requests finite cancellation', async () => {
    const result = await superviseCoordinator(await options('invalid'));
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.report).toEqual({ fixture: true, cancelled: true });
});


test('a caller preparation stage can expire before campaign time while its setup remains unsettled', async () => {
    const value = await options('normal');
    const result = await superviseCoordinator({ ...value, prepare: async control => {
        setTimeout(() => { control.expire('manifest-pinning', ['manifest-pinning']); }, 20);
        await new Promise(resolve => setTimeout(resolve, 180));
    } });
    expect(result.expired).toBe(true);
    expect(result.unresolved.preparation).toBe(true);
    expect(result.unresolved.pendingStages).toContain('manifest-pinning');
    expect(result.events.some(event => event.kind === 'coordinator-spawn')).toBe(false);
});


test('a full 64KiB JSON report remains bounded and is not rejected merely for its IPC envelope', async () => {
    const result = await superviseCoordinator(await options('report-limit'));
    expect(typeof result.report).toBe('string');
    if (typeof result.report === 'string') { expect(result.report.length).toBe(65534); }
    expect(result.failures).toEqual([]);
});

test('a purported worker exit without either an actual code or signal cannot settle ownership', async () => {
    const result = await superviseCoordinator(await options('bad-exit'));
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.unresolved.workers).toHaveLength(1);
    expect(result.report).toEqual({ fixture: true, cancelled: true });
});

for (const mode of ['output-limit', 'concurrency-limit']) {
    test(`${mode} fails before unbounded retention or additional signal authority`, async () => {
        const result = await superviseCoordinator(await options(mode));
        expect(result.failures.length).toBeGreaterThan(0);
        expect(result.report).toEqual({ fixture: true, cancelled: true });
        expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(65536);
        if (mode === 'concurrency-limit') { expect(result.unresolved.workers).toHaveLength(2); }
    });
}
