/** Only the independently watched coordinator child may enter the native campaign after physical pin/release validation. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bounds } from '../src/protocol.js';
import { ExecutionScope } from './deadline.js';
import { sha, validateRelease, verifyManifest } from './freeze.js';
import { record } from './peer.js';
import { publishEvent, publishResult } from './runtime-events.js';
const manifestPath = process.argv[2], releasePath = process.argv[3], startedAt = Number(process.argv[4]);
if (!manifestPath || !releasePath || !Number.isSafeInteger(startedAt) || startedAt > Date.now() || Number(process.env.WAL302_INVOCATION_STARTED_AT) !== startedAt || !process.send || !process.connected) {
    throw new Error('Expected independent outer ownership, frozen manifest and separate root release');
}
const shared = { expired: false }, failures: unknown[] = [];
const scope = new ExecutionScope(startedAt, bounds.coordinatorMilliseconds, shared, () => [], failures, 'coordinator preflight', bounds.stageMilliseconds, (label, pending) => publishEvent({ kind: 'expired', label, at: Date.now(), pendingStages: pending }));
try {
    const raw: unknown = JSON.parse(await scope.stage('coordinator manifest configuration', () => readFile(manifestPath, 'utf8')));
    scope.assert();
    const releaseRaw: unknown = JSON.parse(await scope.stage('coordinator release configuration', () => readFile(releasePath, 'utf8')));
    scope.assert();
    const output = record(raw) && typeof raw.output === 'string' ? raw.output : '';
    const release = validateRelease(releaseRaw, sha(JSON.stringify(raw)), output);
    const manifest = await scope.stage('coordinator physical/runtime pins', () => verifyManifest(raw, import.meta.url));
    scope.assert();
    const invocation: unknown = JSON.parse(await scope.stage('outer invocation receipt', () => readFile(join(output, 'invocation.json'), 'utf8')));
    scope.assert();
    if (!record(invocation) || invocation.startedAt !== startedAt || invocation.tokenSha256 !== sha(release.token) || invocation.manifestDigest !== release.manifestDigest) {
        throw new Error('Independent outer invocation identity differs');
    }
    const { runQualification } = await import('./coordinator.js');
    const report = await runQualification(manifest, startedAt);
    await publishResult(report);
}
finally {
    scope.dispose();
    process.disconnect?.();
}
