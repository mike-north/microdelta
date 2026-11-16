/** Deadline cancellation owns termination requests; actual exit still belongs to each process's close receipt. */
import type { IOwnedProcess } from './ownership.js';
/** Expiry remains observable after cancellation and never claims a still-pending body reached its finally. @internal */
export class OwnedDeadline {
    private readonly timer: ReturnType<typeof setTimeout>;
    private didExpire = false;
    /** Runtime callers use fixed protocol durations; short durations exist only in finite ordinary transport regressions. @internal */
    public constructor(milliseconds: number, owners: () => Iterable<IOwnedProcess>, failures: unknown[], private readonly label: string, onExpire: () => void = () => undefined) {
        this.timer = setTimeout(() => {
            this.didExpire = true;
            onExpire();
            for (const owner of owners()) {
                if (owner.running) {
                    void owner.abort().catch(error => { failures.push(error); });
                }
            }
        }, milliseconds);
    }
    /** An acknowledgment cannot clear an expired deadline. @internal */
    public get expired(): boolean { return this.didExpire; }
    /** Every staged operation checks the same clock instead of renewing its budget. @internal */
    public assert(): void {
        if (this.didExpire) {
            throw new Error(`${this.label} deadline exhausted`);
        }
    }
    /** Disposal stops only the watchdog; it does not claim process or descriptor release. @internal */
    public dispose(): void { clearTimeout(this.timer); }
}
/** Expiry is shared across case/stage budgets so cleanup cannot authorize a later cell. @internal */
export interface IExpirationState {
    expired: boolean;
    reason?: string;
}
/** A fixed absolute budget owns every setup/body stage; pending operations are not represented as completed cleanup. @internal */
export class ExecutionScope {
    private readonly clock: OwnedDeadline;
    private readonly pending = new Set<string>();
    private localExpired = false;
    /** The supplied start precedes setup; production uses fixed protocol ceilings and tests use shorter inert bounds. @internal */
    public constructor(private readonly startedAt: number, private readonly milliseconds: number, private readonly shared: IExpirationState, private readonly owners: () => Iterable<IOwnedProcess>, private readonly failures: unknown[], private readonly label: string, private readonly stageMilliseconds = 5000, private readonly notify: (label: string, pending: readonly string[]) => void = () => undefined) { this.clock = new OwnedDeadline(Math.max(0, startedAt + milliseconds - Date.now()), () => [], failures, label, () => this.expire(`${label} deadline`)); }
    /** Both timer and absolute comparison protect delayed constructor/setup paths. @internal */
    public assert(): void { if (this.clock.expired || Date.now() >= this.startedAt + this.milliseconds) {
        this.expire(`${this.label} deadline`);
    } if (this.shared.expired) {
        throw new Error(this.shared.reason ?? 'Invocation deadline exhausted');
    } }
    /** An expired operation may still return its acquired resource for immediate ownership transfer; no next stage can start. @internal */
    public async stage<T>(label: string, operation: () => Promise<T>): Promise<T> { this.assert(); this.pending.add(label); const timer = setTimeout(() => this.expire(`${label} stage deadline`), Math.min(this.stageMilliseconds, Math.max(0, this.startedAt + this.milliseconds - Date.now()))); try {
        return await operation();
    }
    finally {
        clearTimeout(timer);
        this.pending.delete(label);
    } }
    /** Remaining pending labels are evidence of uncertainty, not proof that finally already executed. @internal */
    public get pendingStages(): readonly string[] { return [...this.pending]; }
    /** Disposal never clears the invocation's sticky expiration fact. @internal */
    public dispose(): void { this.clock.dispose(); }
    /** Every expiry stops future admission and requests cleanup of all current owned workers. */
    private expire(reason: string): void { if (this.localExpired) {
        return;
    } this.localExpired = true; this.shared.expired = true; this.shared.reason = reason; this.notify(reason, [...this.pending]); for (const owner of this.owners()) {
        if (owner.running) {
            void owner.abort().catch(error => { this.failures.push(error); });
        }
    } }
}
/** A returned body value survives a later deadline assertion, so measured counterexamples cannot disappear in cleanup. @internal */
export class CompletedAfterDeadline<T> extends Error {
    public constructor(public readonly value: T, public readonly original: unknown) { super('Body returned after deadline'); }
}
/** One case/control clock includes setup and body; setup cannot spend an unaccounted fresh allowance. @internal */
export async function withCaseBudget<T>(setup: (scope: ExecutionScope) => Promise<void>, body: (scope: ExecutionScope) => Promise<T>, options: {
    readonly milliseconds: number;
    readonly shared: IExpirationState;
    readonly owners: () => Iterable<IOwnedProcess>;
    readonly failures: unknown[];
    readonly label: string;
    readonly stageMilliseconds?: number;
    readonly notify?: (label: string, pending: readonly string[]) => void;
}): Promise<T> { const scope = new ExecutionScope(Date.now(), options.milliseconds, options.shared, options.owners, options.failures, options.label, options.stageMilliseconds, options.notify); try {
    await scope.stage('case setup', () => setup(scope));
    scope.assert();
    const value = await body(scope);
    try {
        scope.assert();
    }
    catch (error: unknown) {
        throw new CompletedAfterDeadline(value, error);
    }
    return value;
}
finally {
    scope.dispose();
} }

/** A boundary reads cancellation facts without mutating the clock, owned work or cleanup state. @internal */
export interface ICaseBoundaryState {
    readonly expired: boolean;
    readonly stopped?: boolean;
    readonly reason?: string;
}
/** Diagnostic selection preserves the existing stop predicate independently of its explanatory text. @internal */
export function caseBoundaryReason(state: ICaseBoundaryState, elapsed: number, limit: number): string | undefined {
    if (state.expired || elapsed >= limit) { return 'Case/coordinator deadline exhausted'; }
    return state.stopped ? state.reason ?? 'Case/coordinator stopped' : undefined;
}
