/** Root-gated independent outer entrypoint; its absolute budget begins before release or manifest I/O. */
import { lstat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bounds } from '../src/protocol.js';
import { ExecutionScope } from './deadline.js';
import { sha, validateRelease, verifyManifest } from './freeze.js';
import { superviseCoordinator } from './outer.js';
import { terminalBoundary } from './terminal.js';
const startedAt = Date.now();
const finish = terminalBoundary(startedAt);
const manifestArgument = process.argv[2], releaseArgument = process.argv[3];
if (!manifestArgument || !releaseArgument) {
    throw new Error('Expected frozen manifest and separate root invocation release; native execution is gated');
}
const manifestPath = resolve(manifestArgument), releasePath = resolve(releaseArgument);
const coordinatorPath = fileURLToPath(new URL('./qualification.js', import.meta.url));
let output = '';
/** Configuration reads remain finite file operations; no native package is imported here. */
async function json(path: string, limit: number): Promise<unknown> { const info = await lstat(path); if (!info.isFile() || info.size > limit) {
    throw new Error('Oversized/nonregular invocation configuration');
} return JSON.parse(await readFile(path, 'utf8')) as unknown; }
const result = await superviseCoordinator({ execPath: process.execPath, entrypoint: coordinatorPath, args: [manifestPath, releasePath, String(startedAt)], startedAt, output: () => output, prepare: async (control) => {
        const shared = { expired: false };
        const failures: unknown[] = [];
        const scope = new ExecutionScope(startedAt, bounds.coordinatorMilliseconds, shared, () => [], failures, 'launcher', bounds.stageMilliseconds, (label, pending) => control.expire(label, pending));
        try {
            const raw = await scope.stage('manifest configuration', () => json(manifestPath, 4 * 1048576));
            scope.assert();
            const releaseRaw = await scope.stage('release configuration', () => json(releasePath, 16384));
            scope.assert();
            const proposedOutput = typeof raw === 'object' && raw !== null && 'output' in raw && typeof raw.output === 'string' ? raw.output : '';
            const release = validateRelease(releaseRaw, sha(JSON.stringify(raw)), proposedOutput);
            const manifest = await scope.stage('pre-spawn physical/runtime pins', () => verifyManifest(raw, import.meta.url));
            scope.assert();
            if (manifest.entrypoints.qualification !== coordinatorPath) {
                throw new Error('Pinned coordinator entrypoint differs from executing launcher');
            }
            output = release.output;
            await scope.stage('exclusive invocation output', () => mkdir(output, { recursive: false, mode: 0o700 }));
            scope.assert();
            await scope.stage('invocation receipt', () => writeFile(join(output, 'invocation.json'), JSON.stringify({ purpose: release.purpose, tokenSha256: sha(release.token), manifestDigest: release.manifestDigest, startedAt, outerDeadlineMilliseconds: bounds.outerMilliseconds, measurementCleanup: 'unresolved until final report' }), { flag: 'wx' }));
            scope.assert();
        }
        finally {
            scope.dispose();
        }
    } });
const unresolved = result.unresolved;
const incomplete = unresolved.coordinator || unresolved.group || unresolved.workers.length > 0 || unresolved.measurement !== 'closed' || unresolved.preparation || unresolved.pendingStages.length > 0;
const observations = result.events.filter(event => event.kind === 'observation');
finish({ code: result.code, signal: result.signal, forced: result.forced, expired: result.expired, verdict: typeof result.report === 'object' && result.report !== null && 'verdict' in result.report ? result.report.verdict : null, report: output ? join(output, 'report.json') : null, unresolved, observations, failures: result.failures, persistenceFailures: result.persistenceFailures, receipt: output ? join(output, 'outer-receipt.json') : null }, result.forced || result.expired || incomplete || result.code !== 0 || result.signal !== null || result.failures.length > 0 || result.persistenceFailures.length > 0 ? 1 : 0);
