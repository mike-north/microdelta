/**
 * One independent POSIX launcher owns one detached coordinator group. Its clocks
 * include caller preparation, and its TERM/KILL/reap reserve lies inside the
 * absolute outer envelope. IPC facts cannot grant signal authority over any PID.
 * Forced exit preserves uncertain acquisition/cleanup instead of claiming finally
 * code ran. This is the fixed experiment watchdog, not a process-management API.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

/** Shorter durations are an inert-test seam; production callers omit this policy and cannot enlarge any ceiling. @internal */
export interface IOuterPolicy {
    readonly campaignMilliseconds: number;
    readonly cleanupMilliseconds: number;
    readonly termMilliseconds: number;
    readonly outerMilliseconds: number;
}
/** Caller stage clocks may close admission while an asynchronous preparation operation remains unsettled. @internal */
export interface IOuterPreparationControl { readonly expire: (label: string, pendingStages?: readonly string[]) => void; }
/** Preparation validates release/physical pins and exclusively creates output before any coordinator exists. @internal */
export interface IOuterOptions {
    readonly execPath: string;
    readonly entrypoint: string;
    readonly args: readonly string[];
    readonly startedAt: number;
    readonly output: string | (() => string);
    readonly prepare?: (control: IOuterPreparationControl) => Promise<void>;
    readonly policy?: IOuterPolicy;
}
/** Retained bounded IPC and actual launcher events remain independent of the coordinator's proposed verdict. @internal */
export interface IOuterEvent { readonly kind: string; readonly [key: string]: unknown; }
/** Worker ownership is reported by the frozen coordinator; only actual matching exit receipts settle a reported slot. @internal */
export interface IOuterWorker { readonly pid: number; readonly role: string; }
/** Pending acquisition, absent receipts and unreaped groups are explicit uncertainty, never native cleanup success. @internal */
export interface IOuterUnresolved {
    readonly coordinator: boolean;
    readonly group: boolean;
    readonly workers: readonly IOuterWorker[];
    readonly measurement: 'not-reported' | 'acquiring' | 'owned' | 'closed' | 'unresolved';
    readonly preparation: boolean;
    readonly pendingStages: readonly string[];
}
/** A received report/counterexample survives later output, shutdown or receipt-write failures. @internal */
export interface IOuterResult {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly forced: boolean;
    readonly expired: boolean;
    readonly report?: unknown;
    readonly events: readonly IOuterEvent[];
    readonly stdout: string;
    readonly stderr: string;
    readonly unresolved: IOuterUnresolved;
    readonly failures: readonly string[];
    readonly persistenceFailures: readonly string[];
}
/** The issued campaign/cleanup/outer ceilings leave a separate signal-escalation and reap reserve. */
const fixedPolicy: IOuterPolicy = { campaignMilliseconds: 480000, cleanupMilliseconds: 5000, termMilliseconds: 1000, outerMilliseconds: 510000 };
/** This helper uses the reserved outer portion of the shared 2MiB structured category, not another proof budget. */
const quotas = { ipcBytes: 256 * 1024, outputBytes: 64 * 1024, receiptBytes: 448 * 1024, messageBytes: 65536 + 256, observationBytes: 8192, events: 512, incomingEvents: 500, workers: 47, liveWorkers: 2, labels: 40, labelCharacters: 160 } as const;
/** Narrow unknown JSON at the IPC boundary without trusting child-supplied ownership or command shapes. */
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** Bounded cause text keeps native/OS errno and the original failure meaning without retaining arbitrary thrown objects. */
function errorFact(value: unknown): string {
    const code = record(value) && typeof value.code === 'string' ? value.code : '';
    const message = value instanceof Error ? value.message : typeof value === 'string' ? value : 'unknown cause';
    return `${code} ${message}`.trim().slice(0, 180);
}
/** Each finite protocol message has only its selected fields, keeping ignored payloads out of retained proof. */
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
/** Labels are facts only; none are interpolated into commands, paths or signal targets. */
function label(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= quotas.labelCharacters; }
/** At most one case's finite pending stages survive an exhausted deadline. */
function labels(value: unknown): value is readonly string[] { return Array.isArray(value) && value.length <= quotas.labels && value.every((item: unknown) => label(item)); }
/** POSIX PID facts must remain finite; signal authority always uses the independently spawned group instead. */
function pid(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 1 && value <= 2147483647; }
/** Test time compression cannot widen runtime bounds or consume the signal/reap reserve. */
function policyFor(value: IOuterPolicy | undefined): IOuterPolicy {
    const result = value ?? fixedPolicy;
    for (const key of ['campaignMilliseconds', 'cleanupMilliseconds', 'termMilliseconds', 'outerMilliseconds'] as const) {
        if (!Number.isSafeInteger(result[key]) || result[key] <= 0 || result[key] > fixedPolicy[key]) { throw new Error('Invalid outer test policy'); }
    }
    if (result.campaignMilliseconds + result.cleanupMilliseconds + result.termMilliseconds + 50 >= result.outerMilliseconds) { throw new Error('Outer policy omits signal/reap reserve'); }
    return result;
}

/**
 * Own the fixed coordinator group through actual close or an explicit unresolved
 * outer boundary. Timers precede prepare; late preparation can never admit spawn.
 * Receipt persistence is separately bounded and cannot erase received evidence.
 * @internal
 */
export async function superviseCoordinator(options: IOuterOptions): Promise<IOuterResult> {
    if (process.platform === 'win32' || !isAbsolute(options.execPath) || !isAbsolute(options.entrypoint) || !Number.isSafeInteger(options.startedAt) || options.startedAt > Date.now() || options.args.length > 8 || options.args.some(arg => Buffer.byteLength(arg) > 4096)) { throw new Error('Invalid fixed POSIX outer invocation'); }
    const policy = policyFor(options.policy);
    const epoch = Date.now(), monotonic = performance.now();
    const now = (): number => epoch + performance.now() - monotonic;
    const campaignDeadline = options.startedAt + policy.campaignMilliseconds;
    const outerDeadline = options.startedAt + policy.outerMilliseconds;
    const receiptReserve = Math.min(250, Math.max(10, Math.floor(policy.outerMilliseconds / 20)));
    const reapReserve = Math.min(1000, Math.max(30, Math.floor(policy.outerMilliseconds / 5)));
    const latestKill = outerDeadline - reapReserve;
    const finishBy = outerDeadline - receiptReserve;
    return await new Promise<IOuterResult>(resolveResult => {
        const events: IOuterEvent[] = [], failures: string[] = [], persistenceFailures: string[] = [];
        const timers = new Set<ReturnType<typeof setTimeout>>();
        const workers = new Map<number, IOuterWorker>(), seenWorkers = new Set<number>(), pendingStages = new Set<string>();
        const stdout: Buffer[] = [], stderr: Buffer[] = [];
        let child: ChildProcess | undefined, group: number | undefined, childClosed = false, childExited = false;
        let code: number | null = null, signal: NodeJS.Signals | null = null;
        let measurement: IOuterUnresolved['measurement'] = 'not-reported';
        let preparation: 'not-started' | 'pending' | 'complete' | 'failed' = 'not-started';
        let forced = false, expired = false, stopping = false, finishing = false, gotReport = false;
        let report: unknown, cleanupDeadline = Infinity, outputBytes = 0, ipcBytes = 0, polling = false;
        /** Store bounded causes once; repeated channel failures cannot turn shutdown into an unbounded transcript. */
        function cause(reason: string): void { if (failures.length < 32 && !failures.includes(reason)) { failures.push(reason.slice(0, 240)); } }
        /** Teardown slots are reserved independently of incoming message count. */
        function retain(event: IOuterEvent): void { if (!finishing && events.length < quotas.events) { events.push(event); } }
        /** Absolute timers never renew the elapsed invocation allowance. */
        function at(deadline: number, action: () => void): void {
            const timer = setTimeout(() => { timers.delete(timer); if (!finishing) { action(); } }, Math.max(0, deadline - now()));
            timers.add(timer);
        }
        /** Probe only the group created by detached spawn; IPC PIDs never become signal targets. */
        function groupAlive(): boolean {
            if (group === undefined) { return false; }
            try { process.kill(-group, 0); return true; }
            catch (error: unknown) { if (record(error) && error.code === 'ESRCH') { return false; } cause('Owned group existence remains uncertain'); return true; }
        }
        /** TERM and KILL affect the owned process group, covering the worker's pre-IPC registration interval. */
        function signalGroup(kind: 'SIGTERM' | 'SIGKILL'): void {
            if (group === undefined || !groupAlive()) { return; }
            forced = true;
            retain({ kind: 'group-signal', signal: kind, at: now() });
            try { process.kill(-group, kind); }
            catch (error: unknown) { if (!record(error) || error.code !== 'ESRCH') { cause(`Owned group ${kind} failed`); } }
        }
        /** Receipt bytes share the reserved outer budget; raw output is base64 to bound control-byte expansion. */
        async function persist(result: IOuterResult): Promise<void> {
            const payload = JSON.stringify({ ...result, stdout: undefined, stderr: undefined, outputEncoding: 'base64', stdoutBase64: Buffer.concat(stdout).toString('base64'), stderrBase64: Buffer.concat(stderr).toString('base64') });
            if (Buffer.byteLength(payload) > quotas.receiptBytes) { persistenceFailures.push('Outer receipt exceeds reserved serialized quota'); return; }
            const remaining = outerDeadline - now();
            if (remaining <= 0) { persistenceFailures.push('Outer receipt has no remaining absolute time'); return; }
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
                const output = typeof options.output === 'string' ? options.output : options.output();
                if (!output || !isAbsolute(output)) { persistenceFailures.push('Validated output unavailable for outer receipt'); return; }
                const written = writeFile(join(output, 'outer-receipt.json'), payload, { flag: 'wx' }).then(() => 'written', (error: unknown) => `failed: ${errorFact(error)}`);
                const outcome = await Promise.race([written, new Promise<'pending'>(resolve => { timeout = setTimeout(() => { resolve('pending'); }, Math.max(1, remaining - 1)); })]);
                if (outcome !== 'written') { persistenceFailures.push(outcome === 'pending' ? 'Outer receipt write unresolved at absolute boundary' : `Outer receipt persistence ${outcome}`); }
            } catch (error: unknown) { persistenceFailures.push(`Outer receipt destination failed: ${errorFact(error)}`); }
            finally { if (timeout) { clearTimeout(timeout); } }
        }
        /** Finalization snapshots facts first and reports unsettled ownership independently of process termination. */
        async function finish(hard = false): Promise<void> {
            if (finishing) { return; }
            const aliveGroup = groupAlive();
            if (hard && child && !childClosed) {
                // An unreaped child remains explicitly owned/unresolved; detached handles must not keep the outer launcher alive indefinitely.
                child.unref();
                child.stdout?.destroy();
                child.stderr?.destroy();
                if (child.connected) { child.disconnect(); }
            }
            if (child && !gotReport) { cause('Coordinator result was not received'); }
            if (workers.size) { cause('Reported worker exits remain unresolved'); }
            if (measurement !== 'closed') { cause('Measurement cleanup/acquisition remains unresolved'); }
            finishing = true;
            for (const timer of timers) { clearTimeout(timer); }
            const base: IOuterResult = { code, signal, forced, expired, events: [...events], stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), unresolved: { coordinator: !!child && !childClosed, group: aliveGroup, workers: [...workers.values()], measurement, preparation: preparation === 'pending', pendingStages: [...pendingStages] }, failures, persistenceFailures };
            const result = gotReport ? { ...base, report } : base;
            await persist(result);
            resolveResult(result);
        }
        /** A late child close is awaited; a dead coordinator with surviving descendants still requires group cleanup. */
        function completion(): void {
            if (finishing) { return; }
            if (!child) { if (preparation !== 'pending' || (stopping && now() >= cleanupDeadline)) { void finish(); } return; }
            if (!childExited && !childClosed) { return; }
            if (groupAlive()) {
                if (!stopping) { stop('coordinator exited with group survivors', now(), false); }
                if (!polling) { polling = true; at(now() + 20, () => { polling = false; completion(); }); }
                return;
            }
            if (childClosed) { void finish(); }
        }
        /** The first exhausted stage/case/campaign closes admission and owns one finite cleanup grace. */
        function stop(reason: string, observedAt: number, deadlineExpired: boolean, pending: readonly string[] = []): void {
            if (finishing) { return; }
            expired ||= deadlineExpired;
            for (const item of pending) { if (pendingStages.size < quotas.labels) { pendingStages.add(item); } else { cause('Pending-stage quota exceeded'); } }
            if (stopping) { return; }
            stopping = true;
            cleanupDeadline = Math.min(observedAt + policy.cleanupMilliseconds, latestKill - policy.termMilliseconds);
            retain({ kind: 'cancel', label: reason.slice(0, quotas.labelCharacters), at: observedAt });
            if (child?.connected) {
                child.send({ kind: 'cancel', label: reason.slice(0, quotas.labelCharacters), at: observedAt }, error => { if (error && !finishing) { cause(`Coordinator cancel delivery failed: ${errorFact(error)}`); } });
            }
            at(cleanupDeadline, () => { signalGroup('SIGTERM'); completion(); });
            at(Math.min(cleanupDeadline + policy.termMilliseconds, latestKill), () => { signalGroup('SIGKILL'); completion(); });
            completion();
        }
        /** Protocol failure is retained before cancellation and never discards an already received report or observation. */
        function invalid(reason: string): void { cause(reason); stop(reason, now(), false); }
        /** All message quotas apply before retaining unknown JSON payloads. */
        function message(value: unknown): void {
            if (finishing) { return; }
            const encoded = JSON.stringify(value);
            if (encoded === undefined) { invalid('Malformed coordinator IPC'); return; }
            const bytes = Buffer.byteLength(encoded);
            ipcBytes += bytes;
            if (bytes > quotas.messageBytes || ipcBytes > quotas.ipcBytes || events.length >= quotas.incomingEvents || !record(value) || typeof value.kind !== 'string') { invalid('Coordinator IPC quota/shape exceeded'); return; }
            const receivedAt = now();
            switch (value.kind) {
                case 'owned-worker': {
                    if (!keys(value, ['kind', 'pid', 'role']) || !pid(value.pid) || value.pid === process.pid || value.pid === group || typeof value.role !== 'string' || !['W', 'R', 'R2', 'V', 'C'].includes(value.role) || seenWorkers.has(value.pid) || seenWorkers.size >= quotas.workers || workers.size >= quotas.liveWorkers) { invalid('Invalid coordinator worker ownership'); return; }
                    seenWorkers.add(value.pid);
                    workers.set(value.pid, { pid: value.pid, role: value.role });
                    break;
                }
                case 'worker-exit': {
                    if (!keys(value, ['kind', 'pid', 'code', 'signal']) || !pid(value.pid) || !workers.has(value.pid) || (value.code === null) === (value.signal === null) || (value.code !== null && (typeof value.code !== 'number' || !Number.isSafeInteger(value.code) || value.code < 0 || value.code > 255)) || (value.signal !== null && (typeof value.signal !== 'string' || !/^SIG[A-Z0-9]{1,12}$/u.test(value.signal)))) { invalid('Invalid coordinator worker exit'); return; }
                    workers.delete(value.pid);
                    break;
                }
                case 'measurement': {
                    if (!keys(value, ['kind', 'state']) || !['acquiring', 'owned', 'closed', 'unresolved'].some(state => value.state === state)) { invalid('Invalid measurement IPC state'); return; }
                    if (value.state === 'acquiring' || value.state === 'owned' || value.state === 'closed' || value.state === 'unresolved') { measurement = value.state; }
                    break;
                }
                case 'expired': {
                    if (!keys(value, ['kind', 'label', 'at', 'pendingStages']) || !label(value.label) || typeof value.at !== 'number' || !Number.isFinite(value.at) || value.at < options.startedAt || value.at > receivedAt + 1000 || (value.pendingStages !== undefined && !labels(value.pendingStages))) { invalid('Invalid expiry IPC fact'); return; }
                    retain({ ...value, kind: value.kind, receivedAt });
                    stop(value.label, Math.min(value.at, receivedAt), true, value.pendingStages ?? []);
                    return;
                }
                case 'observation': {
                    if (!keys(value, ['kind', 'facts']) || !('facts' in value) || bytes > quotas.observationBytes) { invalid('Invalid bounded observation IPC'); return; }
                    break;
                }
                case 'result': {
                    if (!keys(value, ['kind', 'report']) || !('report' in value) || Buffer.byteLength(JSON.stringify(value.report)) > 65536 || gotReport) { invalid('Invalid or duplicate coordinator result'); return; }
                    report = value.report;
                    gotReport = true;
                    retain({ kind: 'result', reportBytes: bytes, receivedAt });
                    return;
                }
                default: { invalid('Unknown coordinator IPC message'); return; }
            }
            retain({ ...value, kind: value.kind, receivedAt });
        }
        /** Raw output is counted before retention; overflow fails rather than truncating a valid-looking transcript. */
        function output(chunk: Buffer, target: Buffer[]): void {
            if (finishing) { return; }
            outputBytes += chunk.length;
            if (outputBytes > quotas.outputBytes) { invalid('Coordinator stdout/stderr quota exceeded'); return; }
            target.push(chunk);
        }
        /** Spawn admits only the preselected frozen child after successful timely preparation. */
        function launch(): void {
            if (finishing || stopping || now() >= campaignDeadline) { if (!stopping) { stop('campaign deadline before coordinator spawn', now(), true); } return; }
            child = spawn(options.execPath, [options.entrypoint, ...options.args], { detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, WAL302_INVOCATION_STARTED_AT: String(options.startedAt) } });
            group = child.pid;
            child.once('spawn', () => { retain({ kind: 'coordinator-spawn', pid: child?.pid, at: now() }); });
            child.on('message', message);
            child.stdout?.on('data', (chunk: Buffer) => { output(chunk, stdout); });
            child.stderr?.on('data', (chunk: Buffer) => { output(chunk, stderr); });
            child.once('error', (error: unknown) => { invalid(`Coordinator spawn/process error: ${errorFact(error)}`); });
            child.once('exit', (exitCode, exitSignal) => { code = exitCode; signal = exitSignal; childExited = true; retain({ kind: 'coordinator-exit', code, signal, at: now() }); completion(); });
            child.once('close', (exitCode, exitSignal) => { code = exitCode; signal = exitSignal; childClosed = true; retain({ kind: 'coordinator-close', code, signal, at: now() }); completion(); });
        }
        // These independent timers exist before any release reading, hashing, output creation or coordinator work.
        at(campaignDeadline, () => { stop('absolute campaign deadline', campaignDeadline, true); });
        at(latestKill, () => { stop('absolute outer kill reserve', now(), true); signalGroup('SIGKILL'); completion(); });
        at(finishBy, () => { expired = true; signalGroup('SIGKILL'); cause('Absolute outer reap boundary exhausted'); void finish(true); });
        if (now() >= campaignDeadline) { stop('campaign deadline before preparation', now(), true); return; }
        preparation = 'pending';
        Promise.resolve().then(async () => { await options.prepare?.({ expire: (reason, pending = []) => { if (!label(reason) || !labels(pending)) { invalid('Invalid preparation expiry fact'); return; } stop(reason, now(), true, pending); } }); }).then(() => {
            if (finishing) { return; }
            preparation = 'complete';
            retain({ kind: 'preparation-complete', at: now() });
            if (stopping) { completion(); } else { launch(); }
        }, (error: unknown) => { if (!finishing) { preparation = 'failed'; invalid(`Caller preparation failed: ${errorFact(error)}`); completion(); } });
    });
}
