/** Finite experiment coordinator: actual fixture/control acknowledgments and source images remain separate from mechanism conclusions. */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

import { assertCommittedPair, classifyCandidate, sourceEffects, validateQualificationReport } from '../src/evidence.js';
import { qualificationBounds } from '../src/protocol.js';
import type { ICaseEvidence, ICaseId, IChildCleanup, IChildRecord, IControlEvidence, ICorrelatedPair, IObservedFailure, IQualificationReport, IRuntimePins, ISourceImage, ISourceStage } from '../src/protocol.js';
import { isRecord, reply } from './transport.js';
import type { IWorkerCommand, IWorkerReply } from './transport.js';

/** The checked-in emitted entrypoint, not a generated stand-in, owns every child action. */
const workerPath = fileURLToPath(new URL('./worker.js', import.meta.url));
/** Source and emitted bytes are pinned separately; neither an unbuilt source nor a package label proves what a child loaded. */
const repository = fileURLToPath(new URL('../../../../', import.meta.url));
/** Explicit cells preserve unexecuted coverage after the first decisive counterexample. */
const caseIds: readonly ICaseId[] = ['closed-wal-no-sidecars', 'active-wal', 'active-readonly-sidecars', 'retained-wal-missing-shm', 'retained-wal-inaccessible-shm', 'missing', 'empty', 'foreign-sqlite', 'corrupt', 'hot-journal'];
/** Independent literal answers do not borrow the candidate's returned data. */
const expectedA: ICorrelatedPair = { revision: 1, currentRevision: 1, value: 'A' };
const expectedB: ICorrelatedPair = { revision: 2, currentRevision: 2, value: 'B' };
/** Actual process exit is distinct from a child's earlier closed-stage acknowledgment. */
interface IExit { readonly code: number | null; readonly signal: NodeJS.Signals | null }
/** One pending finite request owns its response identity and deadline. */
interface IPending { readonly id: number; readonly resolve: (value: IWorkerReply) => void; readonly reject: (error: unknown) => void; readonly timer: ReturnType<typeof setTimeout> }
/** Test tooling can fault only artifact persistence or select a finite fixture entrypoint, without granting worker SQL authority. @internal */
export interface IPeerTestHooks { readonly entrypoint?: string; readonly artifact?: (path: string, data: string | Uint8Array, mode: 'replace' | 'append') => void }
/** Artifact persistence has identical defaults when no finite fault test supplies a replacement. */
function artifact(path: string, data: string | Uint8Array, mode: 'replace' | 'append'): void {
  if (mode === 'append') { appendFileSync(path, data); } else { writeFileSync(path, data); }
}

/** A fixed small child protocol owns termination before recording proof and never lets artifact failures escape its callbacks. @internal */
export class Peer {
  /** Actual responses remain available even if persistence of that response fails. @internal */
  public readonly records: IChildRecord[] = [];
  /** Actual close settles independently of whether exit evidence can be persisted. @internal */
  public readonly exited: Promise<IExit>;
  private readonly child: ChildProcessWithoutNullStreams;
  private lifetime: ReturnType<typeof setTimeout> | undefined;
  private pending: IPending | undefined;
  private sequence = 0;
  private bytes = 0;
  private buffer = '';
  private readonly failures: unknown[] = [];
  private terminal = false;
  private exitAcknowledged = false;

  /** Fixed entrypoints and artifact faults are test tooling seams; defaults always execute the actual checked-in worker. @internal */
  public constructor(private readonly role: 'writer' | 'reader' | 'control', source: string, private readonly proof: string,
    live: Set<Peer>, private readonly count: { value: number }, private readonly bounds: typeof qualificationBounds, private readonly hooks: IPeerTestHooks = {}) {
    if ([...live].filter(peer => peer.running).length >= bounds.maximumChildren) { throw new Error('Child concurrency bound exceeded'); }
    mkdirSync(proof, { recursive: true });
    this.child = spawn(process.execPath, [hooks.entrypoint ?? workerPath, role, join(source, 'store.sqlite')], { stdio: 'pipe' });
    const startedAt = Date.now();
    this.exited = new Promise(resolve => {
      this.child.once('close', (code, signal) => {
        this.terminal = true;
        if (this.lifetime !== undefined) { clearTimeout(this.lifetime); }
        if (this.pending !== undefined) {
          this.remember(new Error('Child exited before acknowledgment'));
          clearTimeout(this.pending.timer); this.pending.reject(this.failures[0]); this.pending = undefined;
        }
        try { (hooks.artifact ?? artifact)(join(proof, 'exit.json'), JSON.stringify({ code, signal, pid: this.child.pid, elapsedMilliseconds: Date.now() - startedAt, requests: this.sequence }), 'replace'); }
        catch (error: unknown) { this.remember(error); }
        finally { resolve({ code, signal }); }
      });
    });
    this.child.once('error', error => this.fail(error));
    // Registry membership survives exit so a failed exit-artifact write cannot erase cleanup facts.
    live.add(this);
    try {
      this.lifetime = setTimeout(() => this.fail(new Error('Owned child lifetime exceeded')), bounds.childMilliseconds);
      const decoder = new StringDecoder('utf8');
      this.child.stdout.on('data', (chunk: Buffer) => {
        try {
          this.bytes += chunk.byteLength;
          if (this.bytes > bounds.maximumChildOutputBytes) { throw new Error('Child output bound exceeded'); }
          this.buffer += decoder.write(chunk);
          if (Buffer.byteLength(this.buffer) > bounds.maximumProtocolLineBytes && !this.buffer.includes('\n')) { throw new Error('Child protocol line bound exceeded'); }
          for (;;) {
            const newline = this.buffer.indexOf('\n'); if (newline < 0) { break; }
            const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
            if (Buffer.byteLength(line) > bounds.maximumProtocolLineBytes) { throw new Error('Child protocol line bound exceeded'); }
            this.records.push({ role: role === 'writer' ? 'writer' : 'reader', line });
            (hooks.artifact ?? artifact)(join(proof, 'records.jsonl'), `${line}\n`, 'append');
            const parsed: unknown = JSON.parse(line); const message = reply(parsed); const pending = this.pending;
            if (pending === undefined || message.id !== pending.id) { throw new Error('Unexpected child response identity'); }
            clearTimeout(pending.timer); this.pending = undefined; pending.resolve(message);
          }
          if (Buffer.byteLength(this.buffer) > bounds.maximumProtocolLineBytes) { throw new Error('Child trailing protocol line bound exceeded'); }
        } catch (error: unknown) { this.fail(error); }
      });
      this.child.stderr.on('data', (chunk: Buffer) => {
        try {
          this.bytes += chunk.byteLength;
          if (this.bytes > bounds.maximumChildOutputBytes) { throw new Error('Child output bound exceeded'); }
          (hooks.artifact ?? artifact)(join(proof, 'stderr.log'), chunk, 'append');
        } catch (error: unknown) { this.fail(error); }
      });
      (hooks.artifact ?? artifact)(join(proof, 'process.json'), JSON.stringify({ pid: this.child.pid, role, workerPath: hooks.entrypoint ?? workerPath, source: join(source, 'store.sqlite'), startedAt }), 'replace');
    } catch (error: unknown) { this.fail(error); }
  }

  /** The registry counts only processes whose actual close event is still outstanding. @internal */
  public get running(): boolean { return !this.terminal; }
  /** Stable process identity remains available even when every artifact write fails. @internal */
  public get identity(): { readonly role: 'writer' | 'reader' | 'control'; readonly pid: number | null } { return { role: this.role, pid: this.child.pid ?? null }; }
  /** First and later in-process failures retain their identities independently of JSON error summaries. @internal */
  public get failureFacts(): { readonly primary: unknown; readonly secondary: readonly unknown[] } | undefined {
    return this.failures.length === 0 ? undefined : { primary: this.failures[0], secondary: this.failures.slice(1) };
  }
  /** Re-observing the same rejection during cleanup must not replace or duplicate its original identity. */
  private remember(error: unknown): void { if (!this.failures.some(previous => previous === error)) { this.failures.push(error); } }

  /** Transport failure kills only this owned child; the exit promise itself stays observable and never rejects unhandled. */
  private fail(error: unknown): void {
    this.remember(error);
    this.stop();
    if (this.pending !== undefined) { clearTimeout(this.pending.timer); this.pending.reject(this.failures[0]); this.pending = undefined; }
  }

  /** Every action is bounded and checked; a child never acknowledges another stage's request. @internal */
  public async ask(action: IWorkerCommand['action'], revision?: number): Promise<IWorkerReply> {
    if (this.failures.length > 0) { throw this.failures[0]; }
    if (this.terminal || this.pending !== undefined) { throw new Error('Child is closed or already has a pending action'); }
    this.count.value += 1;
    if (this.count.value > this.bounds.maximumCommandsPerCase) { throw new Error('Fixture command bound exceeded'); }
    this.sequence += 1; const id = this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Child ${this.role} stage ${action} exceeded deadline`)), this.bounds.stageMilliseconds);
      this.pending = { id, resolve, reject, timer };
      const text = `${JSON.stringify({ id, action, ...(revision === undefined ? {} : { revision }) })}\n`;
      try {
        (this.hooks.artifact ?? artifact)(join(this.proof, 'commands.jsonl'), text, 'append');
        if (Buffer.byteLength(text) > this.bounds.maximumProtocolLineBytes) { throw new Error('Command line bound exceeded'); }
        this.child.stdin.write(text, error => { if (error !== null && error !== undefined) { this.fail(error); } });
      } catch (error: unknown) { this.fail(error); }
    });
  }

  /** Every caller requires an exiting acknowledgment and actual natural success; failure still awaits bounded termination. @internal */
  public async finish(): Promise<IExit> {
    try {
      if (!this.terminal && this.failures.length === 0) {
        const response = await this.ask('exit');
        if (response.kind !== 'exiting') { throw new Error(`Child refused exiting acknowledgment: ${JSON.stringify(response)}`); }
        this.exitAcknowledged = true; this.child.stdin.end();
      }
    } catch (error: unknown) { this.fail(error); }
    const exit = await bounded(this.exited, this.bounds.cleanupMilliseconds, () => this.stop()).catch((error: unknown) => { this.fail(error); throw this.failures[0]; });
    if (!this.exitAcknowledged) { this.remember(new Error('Child exited without an exiting acknowledgment')); }
    if (exit.code !== 0 || exit.signal !== null) { this.remember(new Error(`Child exit was not natural success: ${JSON.stringify(exit)}`)); }
    if (this.failures.length > 0) { throw this.failures[0]; }
    return exit;
  }
  /** Forced cleanup is reserved for an owned failed/incomplete fixture, never source-file recovery or deletion. @internal */
  public stop(): void { if (!this.terminal) { try { this.child.kill('SIGKILL'); } catch (error: unknown) { this.remember(error); } } }
}

/** Every outer wait has one deadline and a caller-owned stop action, without retrying the operation. */
async function bounded<T>(operation: Promise<T>, milliseconds: number, stop: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { stop(); reject(new Error('Finite qualification boundary exceeded')); }, milliseconds); })]);
  } finally { if (timer !== undefined) { clearTimeout(timer); } }
}
/** A fixed-stage error cannot be mistaken for a successful command response. */
function requireKind<T extends IWorkerReply['kind']>(message: IWorkerReply, kind: T): Extract<IWorkerReply, { readonly kind: T }> {
  if (message.kind !== kind) { throw new Error(`Expected ${kind}, observed ${JSON.stringify(message)}`); }
  // The predicate below narrows the discriminated union without an assertion across the transport boundary.
  if (matching(message, kind)) { return message; }
  throw new Error('Unexpected response kind');
}
/** Match a validated transport discriminant while preserving the corresponding result type. */
function matching<T extends IWorkerReply['kind']>(message: IWorkerReply, kind: T): message is Extract<IWorkerReply, { readonly kind: T }> { return message.kind === kind; }
/** Unexecuted is explicit evidence coverage, never an inferred success. */
function unexecuted(id: ICaseId): ICaseEvidence {
  return { id, fixtureHealth: 'unproved', execution: 'unexecuted', committed: 'unproved', coherence: 'unproved', domainMutation: 'unproved', attribution: 'unproved', sourceEffects: [], transientAbsence: 'unproved' };
}
/** Snapshot raw bytes only while the legitimate modifier is paused/closed; retained copies are measurement images, never SQLite read fallbacks. */
function image(source: string, destination: string, bounds: typeof qualificationBounds): ISourceImage {
  mkdirSync(destination, { recursive: true }); let total = 0;
  const files = readdirSync(source).sort().map(name => {
    const location = join(source, name); const stat = lstatSync(location);
    if (!stat.isFile() || stat.size > bounds.maximumSourceFileBytes) { throw new Error('Source shape/file bound exceeded'); }
    total += stat.size; if (total > bounds.maximumSourceBytesPerCase) { throw new Error('Source byte bound exceeded'); }
    const bytes = readFileSync(location); writeFileSync(join(destination, `${name}.bytes`), bytes);
    return { name, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const result: ISourceImage = { files }; writeFileSync(join(destination, 'image.json'), JSON.stringify(result, null, 2)); return result;
}
/** Cleanup accepts the same explicit exit boundary from actual peers and the pure unresolved-exit control. @internal */
export interface ICleanupPeer {
  readonly exited: Promise<IExit>;
  readonly identity?: { readonly role: 'writer' | 'reader' | 'control'; readonly pid: number | null };
  readonly failureFacts?: { readonly primary: unknown; readonly secondary: readonly unknown[] } | undefined;
  stop(): void;
}
/** Actual exit is distinct from an unresolved deadline; original/secondary thrown values remain inspectable in process. @internal */
export type ICleanupOutcome = { readonly index: number; readonly identity: ICleanupPeer['identity']; readonly failures: readonly unknown[] } & (
  | { readonly kind: 'exited'; readonly exit: IExit }
  | { readonly kind: 'unresolved'; readonly error: unknown }
);
/** Attempt every owned termination, retain each finite outcome, and never turn an unresolved exit into missing evidence. @internal */
export async function cleanup(peers: readonly ICleanupPeer[], milliseconds: number = qualificationBounds.cleanupMilliseconds): Promise<readonly ICleanupOutcome[]> {
  const stopping = peers.map((): unknown[] => []);
  const stop = (peer: ICleanupPeer, index: number): void => { try { peer.stop(); } catch (error: unknown) { stopping[index]?.push(error); } };
  peers.forEach(stop);
  return Promise.all(peers.map(async (peer, index): Promise<ICleanupOutcome> => {
    const failures = (): readonly unknown[] => {
      const facts = peer.failureFacts;
      return [...stopping[index] ?? [], ...facts === undefined ? [] : [facts.primary, ...facts.secondary]];
    };
    try {
      const exit = await bounded(peer.exited, milliseconds, () => stop(peer, index));
      return { index, identity: peer.identity, failures: failures(), kind: 'exited', exit };
    } catch (error: unknown) { return { index, identity: peer.identity, failures: failures(), kind: 'unresolved', error }; }
  }));
}
/** JSON records native process facts and finite error fields without promising cross-process thrown-object identity. */
function cleanupEvidence(outcomes: readonly ICleanupOutcome[]): readonly IChildCleanup[] {
  return outcomes.map(outcome => ({ index: outcome.index, pid: outcome.identity?.pid ?? null, role: outcome.identity?.role ?? 'unavailable',
    kind: outcome.kind, ...(outcome.kind === 'exited' ? { exit: outcome.exit } : {}),
    failures: [...outcome.failures, ...outcome.kind === 'unresolved' ? [outcome.error] : []].map(error => infrastructure(error, 'owned-cleanup')) }));
}
/** Preserve a finite infrastructure error when a fixture could not establish the candidate's input or transport. */
function infrastructure(error: unknown, stage: string): IObservedFailure {
  const value = isRecord(error) ? error : undefined;
  return { origin: 'infrastructure', stage, code: typeof value?.code === 'string' ? value.code : null,
    message: (typeof value?.message === 'string' ? value.message : String(error)).slice(0, 1024) };
}

/** Retain the exact checked-in and emitted experiment bytes before spawning; these measurement files are never opened as databases. */
function executionPins(root: string, bounds: typeof qualificationBounds): void {
  const files = ['src/protocol', 'src/evidence', 'test/coordinator', 'test/worker', 'test/transport', 'test/lifetime', 'test/peer-probe', 'test/peer-fixture', 'test/evidence.test', 'test/report.test', 'test/qualification.test', 'test/lifetime.test', 'test/peer.test'];
  const paths = files.flatMap(name => [`experiments/exp-read-snapshot/${name}.ts`, `.test-build/experiments/exp-read-snapshot/${name}.js`]);
  paths.push('package-lock.json', 'package.json', 'experiments/exp-read-snapshot/tsconfig.json', 'experiments/exp-read-snapshot/tsconfig.test.json', 'experiments/exp-read-snapshot/jest.config.mjs');
  const pins = paths.map(path => { const bytes = readFileSync(join(repository, path)); return { path, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }; });
  writeFileSync(join(root, 'execution-pins.json'), JSON.stringify({ recordedUtc: new Date().toISOString(), bounds, files: pins }, null, 2));
}

/** Real held-old and torn-autocommit values challenge the same data oracle, with no main-only/immutable reader. */
async function valueControls(root: string, live: Set<Peer>, bounds: typeof qualificationBounds): Promise<{ readonly controls: readonly IControlEvidence[]; readonly runtime: IRuntimePins }> {
  const source = join(root, 'controls-values/source'); const proof = join(root, 'controls-values/proof'); mkdirSync(source, { recursive: true });
  const count = { value: 0 }; const writer = new Peer('writer', source, join(proof, 'writer'), live, count, bounds);
    const runtime = requireKind(await writer.ask('open'), 'opened').runtime;
    if (runtime === null) { throw new Error('Writer runtime pins are unavailable'); }
    requireKind(await writer.ask('initialize'), 'initialized');
    requireKind(await writer.ask('commit', 1), 'committed'); requireKind(await writer.ask('checkpoint'), 'checkpoint');
    const checkpointed = image(source, join(proof, 'checkpointed-A'), bounds);
    const reader = new Peer('control', source, join(proof, 'reader'), live, count, bounds);
    requireKind(await reader.ask('open'), 'opened'); requireKind(await reader.ask('begin'), 'begun');
    const anchored = requireKind(await reader.ask('anchor'), 'anchored').pair;
    if (assertCommittedPair(anchored, expectedA).kind !== 'satisfied') { throw new Error('Old-anchor control did not establish A'); }
    const acknowledged = requireKind(await writer.ask('commit', 2), 'committed').pair;
    if (assertCommittedPair(acknowledged, expectedB).kind !== 'satisfied') { throw new Error('Writer did not acknowledge B'); }
    const withWal = image(source, join(proof, 'acknowledged-uncheckpointed-B'), bounds);
    const oldMain = checkpointed.files.find(file => file.name === 'store.sqlite'); const main = withWal.files.find(file => file.name === 'store.sqlite');
    if (oldMain?.sha256 !== main?.sha256 || !withWal.files.some(file => file.name === 'store.sqlite-wal' && file.bytes > 0)) { throw new Error('Control failed to preserve B in WAL beyond main A'); }
    const old = requireKind(await reader.ask('read'), 'pair').pair; requireKind(await reader.ask('end'), 'ended');
    const revision = requireKind(await reader.ask('control-meta'), 'meta').revision;
    const next = requireKind(await writer.ask('commit', 3), 'committed').pair;
    const row = requireKind(await reader.ask('control-current'), 'current');
    const mixed = { revision, currentRevision: row.currentRevision, value: row.value };
    const evidence = { anchored, acknowledged, heldOld: old, expectedCurrent: expectedB, next, mixed,
      oldIsLegitimateForItsOwnAnchor: assertCommittedPair(old, expectedA), staleAnswer: assertCommittedPair(old, expectedB), tornAnswer: assertCommittedPair(mixed, expectedB) };
    writeFileSync(join(proof, 'values.json'), JSON.stringify(evidence, null, 2));
    if (evidence.staleAnswer.kind !== 'counterexample' || evidence.tornAnswer.kind !== 'counterexample') { throw new Error('Actual value controls failed oracle sensitivity'); }
    await reader.finish(); await writer.finish();
    return { runtime, controls: [{ name: 'stale-snapshot', execution: 'observed', oracleRejected: true, evidencePath: join(proof, 'values.json'), limitation: 'Legitimate held-old snapshot used only as a deliberately wrong current-B answer; no main-only reader.' },
      { name: 'mixed-revisions', execution: 'observed', oracleRejected: true, evidencePath: join(proof, 'values.json') }] };
}

/** A real IMMEDIATE reservation differs from permitted read locks without fabricating domain claims or writes. */
async function immediateControl(root: string, live: Set<Peer>, bounds: typeof qualificationBounds): Promise<IControlEvidence> {
  const source = join(root, 'control-immediate/source'); const proof = join(root, 'control-immediate/proof'); mkdirSync(source, { recursive: true });
  const count = { value: 0 }; const writer = new Peer('writer', source, join(proof, 'writer'), live, count, bounds);
    requireKind(await writer.ask('open'), 'opened'); requireKind(await writer.ask('initialize'), 'initialized'); requireKind(await writer.ask('commit', 1), 'committed');
    const control = new Peer('control', source, join(proof, 'control'), live, count, bounds);
    requireKind(await control.ask('control-writable'), 'opened'); requireKind(await control.ask('control-immediate'), 'reserved');
    const blocked = requireKind(await writer.ask('commit', 2), 'failed');
    if (blocked.failure.code === null || !blocked.failure.code.startsWith('SQLITE_BUSY')) { throw new Error('IMMEDIATE did not demonstrate native bounded writer contention'); }
    requireKind(await control.ask('control-release'), 'released'); const afterRelease = requireKind(await writer.ask('commit', 2), 'committed').pair;
    if (assertCommittedPair(afterRelease, expectedB).kind !== 'satisfied') { throw new Error('Control reservation did not release'); }
    const path = join(proof, 'reservation.json'); writeFileSync(path, JSON.stringify({ blocked, afterRelease, domainMutationFromReservation: false }, null, 2));
    await control.finish(); await writer.finish(); return { name: 'immediate', execution: 'observed', oracleRejected: true, evidencePath: path,
      limitation: 'Shows prohibited candidate write-reservation/contention sensitivity; reservation itself is not History/domain mutation.' };
}

/** Deliberate sampled and restored effects expose exactly what the endpoint collector can and cannot establish. */
function filesystemControls(root: string, bounds: typeof qualificationBounds): readonly IControlEvidence[] {
  const source = join(root, 'controls-files/source'); const proof = join(root, 'controls-files/proof'); mkdirSync(source, { recursive: true });
  const file = join(source, 'control.bin'); writeFileSync(file, Buffer.alloc(16, 0x11)); const before = image(source, join(proof, 'before'), bounds);
  writeFileSync(file, Buffer.alloc(16, 0x22)); writeFileSync(join(source, 'control-sidecar'), 'sidecar'); const changed = image(source, join(proof, 'changed'), bounds);
  unlinkSync(join(source, 'control-sidecar')); const removed = image(source, join(proof, 'removed'), bounds);
  writeFileSync(file, Buffer.alloc(16, 0x33)); writeFileSync(join(source, 'control-transient'), 'temporary');
  unlinkSync(join(source, 'control-transient')); writeFileSync(file, Buffer.alloc(16, 0x22)); const restored = image(source, join(proof, 'restored'), bounds);
  const changes = sourceEffects(before, changed); const removals = sourceEffects(changed, removed); const missed = sourceEffects(removed, restored);
  if (changes.length !== 2 || removals.length !== 1 || missed.length !== 0) { throw new Error('Source-effect controls failed their exact sensitivity/limitation'); }
  const path = join(proof, 'effects.json'); writeFileSync(path, JSON.stringify({ changes, removals, deliberatelyMissedTransientEffects: missed, method: 'sampled endpoints only; no native/mmap absence proof' }, null, 2));
  return [{ name: 'content-and-sidecar', execution: 'observed', oracleRejected: true, evidencePath: path },
    { name: 'transient-restoration', execution: 'observed', oracleRejected: false, evidencePath: path, limitation: 'Sampled images missed deliberate write/restore and create/remove between stages; native/mmap absence remains unproved.' }];
}

/** The first mandatory healthy layout is produced by real Machine commits and clean owner close, never manual sidecar deletion. */
async function closedCase(root: string, live: Set<Peer>, bounds: typeof qualificationBounds, record: (cell: ICaseEvidence) => void): Promise<ICaseEvidence> {
  const source = join(root, 'closed-wal-no-sidecars/source'); const proof = join(root, 'closed-wal-no-sidecars/proof'); mkdirSync(source, { recursive: true });
  const count = { value: 0 }; const writer = new Peer('writer', source, join(proof, 'writer'), live, count, bounds);
    requireKind(await writer.ask('open'), 'opened'); requireKind(await writer.ask('initialize'), 'initialized');
    const a = requireKind(await writer.ask('commit', 1), 'committed').pair; const b = requireKind(await writer.ask('commit', 2), 'committed').pair;
    if (assertCommittedPair(a, expectedA).kind !== 'satisfied' || assertCommittedPair(b, expectedB).kind !== 'satisfied') { throw new Error('Closed fixture commits were not acknowledged exactly'); }
    requireKind(await writer.ask('close'), 'closed'); const ownerExit = await writer.finish();
    if (ownerExit.code !== 0 || ownerExit.signal !== null) { throw new Error('Closed fixture owner did not exit normally'); }
    const sourceImages: ISourceStage[] = [{ stage: 'before-open', image: image(source, join(proof, 'images/before-open'), bounds) }];
    const before = sourceImages[0]?.image; const headerBytes = readFileSync(join(source, 'store.sqlite'));
    const header = { readVersion: headerBytes[18] ?? -1, writeVersion: headerBytes[19] ?? -1 };
    if (before?.files.length !== 1 || before.files[0]?.name !== 'store.sqlite' || headerBytes.subarray(0, 16).toString() !== 'SQLite format 3\0'
      || header.readVersion !== 2 || header.writeVersion !== 2) { throw new Error('Healthy closed WAL/no-sidecars provenance was not established'); }
    const baseline = before;
    const reader = new Peer('reader', source, join(proof, 'reader'), live, count, bounds);
    const reads: { readonly expected: ICorrelatedPair; readonly actual: ICorrelatedPair }[] = [];
    let failure: IObservedFailure | undefined;
    let candidateRuntime: IRuntimePins | undefined;
    /** Retain each measured stage immediately, so a later query/transport/close error cannot erase an observed counterexample. */
    const makeCell = (): ICaseEvidence => {
      const effects = [...new Map(sourceImages.flatMap(stage => sourceEffects(baseline, stage.image)).map(effect => [`${effect.kind}:${effect.name}`, effect])).values()];
      const valueResults = reads.map(read => assertCommittedPair(read.actual, read.expected));
      const cell: ICaseEvidence = { id: 'closed-wal-no-sidecars', fixtureHealth: 'verified-healthy', execution: failure === undefined ? 'observed' : 'refused',
        committed: valueResults.some(result => result.kind === 'counterexample') ? 'counterexample' : reads.length > 0 ? 'satisfied' : 'unproved',
        coherence: valueResults.some(result => result.kind === 'counterexample' && result.reason === 'mixed-revisions') ? 'counterexample' : reads.length > 0 ? 'satisfied' : 'unproved',
        domainMutation: 'none', attribution: 'reader-only', sourceEffects: effects, transientAbsence: 'unproved',
        observations: { ownerAcknowledgments: [a, b], ownerExit, header, sourceImages: [...sourceImages], reads: [...reads], childRecords: [...writer.records, ...reader.records], domainMutationOperations: [],
          ...(candidateRuntime === undefined ? {} : { runtime: candidateRuntime }), ...(failure === undefined ? {} : { failure }) } };
      writeFileSync(join(proof, 'case.json'), JSON.stringify(cell, null, 2)); record(cell); return cell;
    };
    const capture = (stage: ISourceStage['stage']): void => {
      sourceImages.push({ stage, image: image(source, join(proof, 'images', stage), bounds) }); makeCell();
    };
    const opened = await reader.ask('open');
    if (opened.kind === 'failed') { failure = opened.failure; capture('failed'); }
    else {
      requireKind(opened, 'opened'); capture('opened'); requireKind(await reader.ask('begin'), 'begun');
      const anchored = await reader.ask('anchor');
      if (anchored.kind === 'failed') { failure = anchored.failure; capture('failed'); }
      else {
        reads.push({ expected: expectedB, actual: requireKind(anchored, 'anchored').pair }); capture('anchored');
        reads.push({ expected: expectedB, actual: requireKind(await reader.ask('read'), 'pair').pair }); capture('queried');
        candidateRuntime = requireKind(await reader.ask('runtime'), 'runtime').runtime; capture('pinned');
        requireKind(await reader.ask('end'), 'ended'); capture('ended'); requireKind(await reader.ask('close'), 'closed'); capture('closed');
        requireKind(await reader.ask('close'), 'closed');
        const afterClose = requireKind(await reader.ask('read'), 'failed');
        if (!afterClose.failure.message.includes('closed')) { throw new Error('Use after close was not explicitly refused'); }
      }
    }
    const readerExit = await reader.finish();
    if (readerExit.code !== 0 || readerExit.signal !== null) { throw new Error('Candidate child did not exit normally'); }
    if (!sourceImages.some(stage => stage.stage === 'closed')) { capture('closed'); }
    return makeCell();
}

/** Execute the approved counterexample-first qualification; no green harness result promotes the rejected mechanism. @internal */
export async function runQualification(bounds: typeof qualificationBounds): Promise<IQualificationReport> {
  const root = mkdtempSync(join(tmpdir(), 'microdelta-read-snapshot-')); const live = new Set<Peer>();
  executionPins(root, bounds);
  const cases = caseIds.map(unexecuted); const controls: IControlEvidence[] = []; let runtime: IRuntimePins | null = null;
  let stage = 'controls';
  try {
    const operation = async (): Promise<IQualificationReport> => {
      const values = await bounded(valueControls(root, live, bounds), bounds.caseMilliseconds, () => { for (const peer of live) { peer.stop(); } });
      controls.push(...values.controls); runtime = values.runtime;
      controls.push(await bounded(immediateControl(root, live, bounds), bounds.caseMilliseconds, () => { for (const peer of live) { peer.stop(); } }));
      controls.push(...filesystemControls(root, bounds)); stage = 'closed-candidate';
      const closed = await bounded(closedCase(root, live, bounds, cell => { cases[0] = cell; }), bounds.caseMilliseconds, () => { for (const peer of live) { peer.stop(); } });
      cases[0] = closed; const verdict = classifyCandidate(cases);
      const rejectionWitness = closed.sourceEffects.length > 0 ? { caseId: closed.id, kind: 'source-effect' as const }
        : closed.execution === 'refused' ? { caseId: closed.id, kind: 'read-failure' as const }
          : closed.committed === 'counterexample' ? { caseId: closed.id, kind: 'committed-value' as const } : undefined;
      const report: IQualificationReport = { harness: 'completed', verdict, cases, controls, runtime: closed.observations?.runtime ?? values.runtime, artifactDirectory: root,
        limitations: ['Endpoint samples do not prove absence of transient/native/mmap effects.',
          verdict === 'REJECT' ? 'Stopped after the decisive closed-layout counterexample; all later candidate cells are explicitly unexecuted.' : 'Closed stage supplied no decisive rejection; remaining approved matrix and operation-wide absence remain unproved.'],
        ...(rejectionWitness === undefined ? {} : { rejectionWitness }) };
      const valid = validateQualificationReport(report); if (valid.kind !== 'valid') { throw new Error(`Qualification report failed evidence assertions: ${JSON.stringify(valid)}`); }
      return report;
    };
    const result = await bounded(operation(), bounds.totalMilliseconds, () => { for (const peer of live) { peer.stop(); } });
    if ([...live].some(peer => peer.running)) { throw new Error('Qualification still has an owned live child'); }
    const report: IQualificationReport = { ...result, cleanup: cleanupEvidence(await cleanup([...live])) };
    if (validateQualificationReport(report).kind !== 'valid') { throw new Error('Qualification has incomplete owned cleanup'); }
    writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2)); return report;
  } catch (error: unknown) {
    const outcomes = await cleanup([...live]); const ownedCleanup = cleanupEvidence(outcomes); const failure = infrastructure(error, stage);
    try { writeFileSync(join(root, 'failure-and-cleanup.json'), JSON.stringify({ failure, cleanup: ownedCleanup }, null, 2)); }
    catch (later: unknown) {
      process.stderr.write(`${JSON.stringify({ failure, cleanup: ownedCleanup, secondary: infrastructure(later, 'failure-evidence-write') })}\n`);
      throw error;
    }
    if (outcomes.some(outcome => outcome.kind === 'unresolved')) { throw error; }
    if (classifyCandidate(cases) === 'REJECT') {
      // A broken harness must fail, while its already measured native counterexample remains retained instead of becoming INCONCLUSIVE.
      try { writeFileSync(join(root, 'failure-after-counterexample.json'), JSON.stringify({ verdict: 'REJECT', cases, controls, runtime, failure, cleanup: ownedCleanup }, null, 2)); } catch { /* Secondary evidence failure cannot replace the original error. */ }
      throw error;
    }
    const record: IChildRecord = { role: 'coordinator', line: JSON.stringify({ kind: 'preparation-or-transport-failure', failure }) };
    const report: IQualificationReport = { harness: 'infrastructure-inconclusive', verdict: 'INCONCLUSIVE', cases, controls, runtime,
      artifactDirectory: root, cleanup: ownedCleanup, limitations: [failure.message], preparation: { attempted: true, failure, records: [record], sourceImages: [] } };
    const validation = validateQualificationReport(report);
    if (validation.kind !== 'valid') { throw error; }
    try { writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2)); } catch { throw error; }
    return report;
  }
}
