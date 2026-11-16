/** Inert outer-watchdog fixtures exercise IPC and one process-group descendant; they never import qualification, workers or SQLite. */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

/** Fixture messages use only the same bounded facts expected from the separately reviewed coordinator. */
interface IFixtureMessage { readonly kind: string; readonly [key: string]: unknown; }
/** Flush small fixed messages before blocking the fixture's event loop. */
async function emit(message: IFixtureMessage): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        if (!process.send) { reject(new Error('Inert fixture requires IPC')); return; }
        process.send(message, error => { if (error) { reject(error); } else { resolve(); } });
    });
}
/** A successful inert finish closes IPC naturally; no acknowledgment substitutes for the parent's actual close event. */
async function finish(report: unknown): Promise<void> {
    await emit({ kind: 'result', report });
    process.disconnect?.();
}
/** The fixed fixture mode selects a finite test recipe, never a caller-supplied command. */
const mode = process.argv[2] ?? 'normal';
/** A safety horizon bounds a failed regression independently of the mechanism under test. */
const stopAt = Date.now() + 4000;
if (mode === 'normal' || mode === 'report-limit') {
    await emit({ kind: 'measurement', state: 'closed' });
    if (mode === 'normal') { process.stdout.write('inert normal\n'); }
    await finish(mode === 'report-limit' ? 'a'.repeat(65534) : { fixture: true, verdict: 'INCONCLUSIVE' });
} else if (mode === 'expired' || mode === 'invalid' || mode === 'bad-exit' || mode === 'output-limit' || mode === 'concurrency-limit') {
    let cancelled = false;
    process.on('message', (message: unknown) => {
        if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'cancel' && !cancelled) {
            cancelled = true;
            void (async () => { await emit({ kind: 'measurement', state: 'closed' }); await finish({ fixture: true, cancelled: true }); })();
        }
    });
    if (mode === 'bad-exit') {
        await emit({ kind: 'owned-worker', pid: process.pid + 100000, role: 'R' });
        await emit({ kind: 'worker-exit', pid: process.pid + 100000, code: null, signal: null });
    } else if (mode === 'concurrency-limit') {
        // These are untrusted protocol facts only; the test creates no worker processes for these claimed identities.
        for (let index = 0; index < 3; index++) { await emit({ kind: 'owned-worker', pid: process.pid + 100000 + index, role: 'R' }); }
    } else if (mode === 'output-limit') {
        process.stdout.write('a'.repeat(65537));
    } else {
        await emit(mode === 'expired' ? { kind: 'expired', label: 'Q1.setup', at: Date.now(), pendingStages: ['Q1.setup'] } : { kind: 'owned-worker', pid: -1, role: 'R' });
    }
    setTimeout(() => { if (!cancelled) { void (async () => { await emit({ kind: 'observation', facts: { cell: 'later-cell-ran' } }); await finish({ fixture: true, cancelled: false }); })(); } }, 120);
    setTimeout(() => { process.exit(99); }, 4000).unref();
} else {
    process.on('SIGTERM', () => { /* The independent supervisor must escalate a coordinator that does not settle on TERM. */ });
    if (mode === 'blocked' || mode === 'gap') {
        const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),4000);setInterval(()=>{},1000)"], { stdio: 'ignore', detached: false });
        const pid = descendant.pid;
        if (!pid) { throw new Error('Inert descendant was not spawned'); }
        const pidFile = process.argv[3];
        if (pidFile) { await writeFile(pidFile, String(pid), { flag: 'wx' }); }
        if (mode !== 'gap') { await emit({ kind: 'owned-worker', pid, role: 'R' }); }
    }
    if (mode === 'counterexample') { await emit({ kind: 'observation', facts: { outcome: 'counterexample', pair: { metadataRevision: 2, currentRevision: 3, value: 'C' } } }); }
    await emit({ kind: 'measurement', state: mode === 'acquiring' || mode === 'counterexample' ? 'acquiring' : 'owned' });
    await emit({ kind: 'observation', facts: { coordinatorPid: process.pid, mode } });
    // This models the old same-event-loop watchdog: its timer cannot run during the busy body.
    setTimeout(() => { process.exit(98); }, 50);
    while (Date.now() < stopAt) { /* A bounded busy loop deliberately stalls only this inert coordinator. */ }
    process.exit(97);
}
