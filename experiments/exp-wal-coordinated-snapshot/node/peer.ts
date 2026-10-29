/** Bounded newline transport owns children from spawn through actual close, independently of artifact writes. */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { bounds } from '../src/protocol.js';
import { publishEvent } from './runtime-events.js';
/** Actual close receipts, not acknowledgments, release concurrency slots. @internal */
export interface IExit {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
}
/** Response payloads remain unknown until the caller's scenario oracle validates their meaning. @internal */
export interface IReply {
    readonly id: number;
    readonly kind: string;
    readonly [key: string]: unknown;
}
/** Narrow test seams inject finite process behavior and persistence failure without SQLite. @internal */
export interface IPeerHooks {
    /** Synchronous received-fact observer runs before any asynchronous proof or cleanup. */
    readonly onReceived?: (action: string, reply: IReply) => void;
    readonly entrypoint?: string;
    readonly persist?: (path: string, bytes: string | Uint8Array) => void | Promise<void>;
    readonly stageMilliseconds?: number;
    readonly cleanupMilliseconds?: number;
}
/** One pending request preserves identity, its deadline and its primary rejection. */
interface IPending {
    readonly id: number;
    readonly action: string;
    readonly resolve: (value: IReply) => void;
    readonly reject: (reason: unknown) => void;
    readonly timer: ReturnType<typeof setTimeout>;
}
/** Validate transport shape before any scenario can use the child's claim. @internal */
export function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** A finite owned child never receives inherited measurement descriptors or arbitrary SQL. @internal */
export class Peer {
    /** In-memory records survive disk failure and preserve every received payload. @internal */
    public readonly records: IReply[] = [];
    /** Cleanup resolves on actual close even if persistence fails. @internal */
    public readonly exited: Promise<IExit>;
    private readonly child: ChildProcessWithoutNullStreams;
    private proofQueue: Promise<void> = Promise.resolve();
    private received: {
        readonly action: string;
        readonly reply: IReply;
    } | undefined;
    private stderrLineBytes = 0;
    private terminal = false;
    private pending: IPending | undefined;
    private sequence = 0;
    private bytes = 0;
    private buffer = '';
    private failures: unknown[] = [];
    private acknowledged = false;
    private readonly lifetime: ReturnType<typeof setTimeout>;
    /** Registry insertion precedes fallible proof persistence; stdin/stdout/stderr are the only inherited channels. @internal */
    public constructor(public readonly role: string, source: string, public readonly proofDirectory: string, live: Set<Peer>, private readonly count: {
        value: number;
    }, private readonly hooks: IPeerHooks = {}) {
        if ([...live].filter(peer => peer.running).length >= 2) {
            throw new Error('Worker concurrency bound exceeded');
        }
        this.child = spawn(process.execPath, [hooks.entrypoint ?? fileURLToPath(new URL('./worker.js', import.meta.url)), role, source], { stdio: ['pipe', 'pipe', 'pipe'], env: { WAL302_ADDON_SHA: process.env.WAL302_ADDON_SHA, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR } });
        live.add(this);
        if (this.child.pid) {
            publishEvent({ kind: 'owned-worker', pid: this.child.pid, role });
        }
        this.exited = new Promise(resolve => {
            this.child.once('close', (code, signal) => {
                this.terminal = true;
                publishEvent({ kind: 'worker-exit', pid: this.child.pid, code, signal });
                if (this.buffer.length) {
                    this.remember(new Error('Unterminated protocol bytes at exit'));
                }
                clearTimeout(this.lifetime);
                if (this.pending) {
                    clearTimeout(this.pending.timer);
                    this.pending.reject(this.failures.length ? this.failures[0] : new Error('Unexpected exit before acknowledgment'));
                    this.pending = undefined;
                }
                void this.persist('exit.jsonl', JSON.stringify({ pid: this.child.pid, code, signal }) + '\n').catch((error: unknown) => this.remember(error));
                resolve({ code, signal });
            });
        });
        this.lifetime = setTimeout(() => this.fail(new Error('Worker 25s lifetime exceeded')), bounds.workerMilliseconds);
        this.child.once('error', error => this.fail(error));
        const decoder = new StringDecoder('utf8');
        this.child.stdout.on('data', (chunk: Buffer) => {
            const failures: unknown[] = [];
            let prepared: {
                pending: IPending;
                reply: IReply;
            } | undefined;
            try {
                // Admission precedes both parsing and retention; all retained receipts share the raw child quota.
                this.consume(chunk);
                this.buffer += decoder.write(chunk);
                for (;;) {
                    const index = this.buffer.indexOf('\n');
                    if (index < 0) {
                        break;
                    }
                    const line = this.buffer.slice(0, index);
                    this.buffer = this.buffer.slice(index + 1);
                    if (Buffer.byteLength(line) > bounds.lineBytes) {
                        throw new Error('Protocol line exceeds 8192 bytes');
                    }
                    const value: unknown = JSON.parse(line);
                    if (!record(value) || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || typeof value.kind !== 'string') {
                        throw new Error('Malformed reply');
                    }
                    const pending = this.pending;
                    if (!pending || prepared || pending.id !== value.id) {
                        throw new Error('Unexpected response identity');
                    }
                    const reply: IReply = { ...value, id: value.id, kind: value.kind };
                    this.records.push(reply);
                    this.received = { action: pending.action, reply };
                    prepared = { pending, reply };
                    this.hooks.onReceived?.(pending.action, reply);
                }
                if (Buffer.byteLength(this.buffer) > bounds.lineBytes) {
                    throw new Error('Unterminated protocol line exceeds bound');
                }
            }
            catch (error: unknown) {
                failures.push(error);
            }
            // A validated reply is already in memory before asynchronous proof persistence can reject ask().
            const persist = this.bytes <= bounds.childOutputBytes ? this.persist('stdout.jsonl', chunk) : Promise.resolve();
            void persist.then(() => { if (failures.length) {
                for (const error of failures) {
                    this.fail(error);
                }
                return;
            } if (prepared) {
                clearTimeout(prepared.pending.timer);
                if (this.pending === prepared.pending) {
                    this.pending = undefined;
                    prepared.pending.resolve(prepared.reply);
                }
            } }, (error: unknown) => { for (const failure of failures) {
                this.fail(failure);
            } this.fail(error); });
        });
        this.child.stderr.on('data', (chunk: Buffer) => {
            try {
                this.consume(chunk);
                void this.persist('stderr.log', chunk).catch((error: unknown) => this.fail(error));
                for (const byte of chunk) {
                    this.stderrLineBytes = byte === 10 ? 0 : this.stderrLineBytes + 1;
                    if (this.stderrLineBytes > 8192) {
                        throw new Error('Stderr line exceeds 8192 bytes');
                    }
                }
            }
            catch (error: unknown) {
                this.fail(error);
            }
        });
        void this.persist('process.jsonl', JSON.stringify({ pid: this.child.pid, role, source, stdio: ['pipe', 'pipe', 'pipe'] }) + '\n').catch((error: unknown) => this.fail(error));
    }
    /** Only actual close changes running; a child response cannot free a slot. @internal */
    public get running(): boolean { return !this.terminal; }
    /** Stable identity remains available even when process-artifact persistence fails. @internal */
    public get identity(): {
        readonly role: string;
        readonly pid: number | null;
    } { return { role: this.role, pid: this.child.pid ?? null }; }
    /** All causes remain distinct in-process, including thrown undefined. @internal */
    public get failureFacts(): readonly unknown[] { return this.failures; }
    /** The last validated reply survives rejection of its proof persistence, with the exact requested action. @internal */
    public get lastReceived(): {
        readonly action: string;
        readonly reply: IReply;
    } | undefined { return this.received; }
    /** Every request fits the selected command frame and global per-case count. @internal */
    public async ask(action: string): Promise<IReply> {
        if (this.failures.length) {
            throw this.failures[0];
        }
        if (this.terminal || this.pending) {
            throw new Error('Worker closed or busy');
        }
        if (++this.count.value > 40) {
            throw new Error('Case command quota exceeded');
        }
        const id = ++this.sequence;
        const text = JSON.stringify({ id, action }) + '\n';
        if (Buffer.byteLength(text) > 256) {
            throw new Error('Command exceeds 256 bytes');
        }
        return new Promise((resolve, reject) => { this.received = undefined; this.pending = { id, action, resolve, reject, timer: setTimeout(() => this.fail(new Error('Stage deadline exceeded')), this.hooks.stageMilliseconds ?? 5000) }; void this.persist('commands.jsonl', text).then(() => { if (this.failures.length || !this.pending) {
            return;
        } this.child.stdin.write(text, error => { if (error) {
            this.fail(error);
        } }); }, (error: unknown) => this.fail(error)); });
    }
    /** Normal completion requires exit acknowledgment and actual code-zero/no-signal close. @internal */
    public async finish(): Promise<IExit> {
        if (!this.acknowledged && this.running) {
            const reply = await this.ask('exit');
            if (reply.kind !== 'exiting') {
                throw new Error('Exit acknowledgment refused');
            }
            this.acknowledged = true;
            this.child.stdin.end();
        }
        const exit = await this.waitExit();
        await this.proofQueue;
        if (!this.acknowledged || exit.code !== 0 || exit.signal !== null) {
            throw new Error('Exit is not acknowledged natural success');
        }
        if (this.failures.length) {
            throw this.failures[0];
        }
        return exit;
    }
    /** Ledger exit commands use this method to avoid sending a duplicate request. @internal */
    public async acknowledgeExit(reply: IReply): Promise<IExit> {
        if (reply.kind !== 'exiting') {
            throw new Error('Exit acknowledgment refused');
        }
        this.acknowledged = true;
        this.child.stdin.end();
        return this.finish();
    }
    /** Fixture-only writer kills require an actual signal receipt and never count as reader release. @internal */
    public async killFixture(): Promise<IExit> { this.stop(); return this.waitExit(); }
    /** All failure paths attempt owned termination and await bounded actual exit. @internal */
    public async abort(): Promise<IExit> { const until = Date.now() + (this.hooks.cleanupMilliseconds ?? 5000); this.stop(); const exit = await this.waitExit(); let timer: ReturnType<typeof setTimeout> | undefined; try {
        await Promise.race([this.proofQueue, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Unresolved proof persistence cleanup')), Math.max(0, until - Date.now())); })]);
    }
    catch (error: unknown) {
        if (!this.failures.includes(error)) {
            this.remember(error);
        }
    }
    finally {
        if (timer) {
            clearTimeout(timer);
        }
    } return exit; }
    /** Counting precedes persistence; oversize data cannot become valid by truncation. */
    private consume(bytes: Buffer): void {
        this.bytes += bytes.byteLength;
        if (this.bytes > 131072) {
            throw new Error('Child aggregate output exceeds 128KiB');
        }
    }
    /** Persistence ports preserve the same append semantics in ordinary and fault runs. */
    private persist(name: string, bytes: string | Uint8Array): Promise<void> { const path = join(this.proofDirectory, `${this.role}-${name}`); this.proofQueue = this.proofQueue.catch(() => undefined).then(async () => { await (this.hooks.persist ?? appendFile)(path, bytes); }); return this.proofQueue; }
    /** The original thrown cause remains primary while cleanup adds later causes. */
    private remember(error: unknown): void { this.failures.push(error); }
    /** Fail-closed transport stops only the registered child and settles pending work. */
    private fail(error: unknown): void {
        this.remember(error);
        this.stop();
        if (this.pending) {
            clearTimeout(this.pending.timer);
            this.pending.reject(this.failures[0]);
            this.pending = undefined;
        }
    }
    /** No process group or unrelated worker is ever signaled. */
    private stop(): void {
        if (!this.terminal) {
            try {
                this.child.kill('SIGKILL');
            }
            catch (error: unknown) {
                this.remember(error);
            }
        }
    }
    /** A deadline reports unresolved cleanup instead of claiming that termination completed. */
    private async waitExit(): Promise<IExit> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([this.exited, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Unresolved worker cleanup')), this.hooks.cleanupMilliseconds ?? 5000); })]);
        }
        finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }
}
