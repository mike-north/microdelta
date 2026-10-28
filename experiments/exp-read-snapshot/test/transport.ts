/** Finite experiment-only child protocol; it carries fixed host actions and facts, never arbitrary SQL or production authority. */
import type { ICorrelatedPair, IObservedFailure, IRuntimePins } from '../src/protocol.js';

/** Commands are named fixed experiment stages; only control-role workers accept deliberate bad-mechanism stages. @internal */
export interface IWorkerCommand { readonly id: number; readonly action: 'open' | 'initialize' | 'commit' | 'checkpoint' | 'begin' | 'anchor' | 'read' | 'runtime' | 'end' | 'close' | 'exit' | 'control-meta' | 'control-current' | 'control-writable' | 'control-immediate' | 'control-release'; readonly revision?: number }
/** Replies retain actual data and native errors separately from stage labels. @internal */
type IStageKind = 'initialized' | 'begun' | 'ended' | 'closed' | 'exiting' | 'reserved' | 'released';
/** Each stage is a true discriminant, including stages whose payload is only an acknowledgment. */
type IStageReply = { readonly [T in IStageKind]: { readonly id: number; readonly kind: T } }[IStageKind];
/** Replies retain actual data and native errors separately from stage labels. @internal */
export type IWorkerReply =
  | { readonly id: number; readonly kind: 'opened'; readonly runtime: IRuntimePins | null }
  | { readonly id: number; readonly kind: 'runtime'; readonly runtime: IRuntimePins }
  | IStageReply
  | { readonly id: number; readonly kind: 'committed'; readonly pair: ICorrelatedPair }
  | { readonly id: number; readonly kind: 'anchored'; readonly pair: ICorrelatedPair }
  | { readonly id: number; readonly kind: 'pair'; readonly pair: ICorrelatedPair }
  | { readonly id: number; readonly kind: 'meta'; readonly revision: number }
  | { readonly id: number; readonly kind: 'current'; readonly currentRevision: number; readonly value: string }
  | { readonly id: number; readonly kind: 'checkpoint'; readonly result: readonly unknown[] }
  | { readonly id: number; readonly kind: 'failed'; readonly failure: IObservedFailure; readonly cleanup: readonly IObservedFailure[] };

/** Narrow every JSON boundary before any field drives a command or evidence conclusion. @internal */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** Fixed command vocabulary is shared by coordinator and the single finite worker entrypoint. */
const actions: readonly IWorkerCommand['action'][] = ['open', 'initialize', 'commit', 'checkpoint', 'begin', 'anchor', 'read', 'runtime', 'end', 'close', 'exit', 'control-meta', 'control-current', 'control-writable', 'control-immediate', 'control-release'];
/** An unknown transport value cannot introduce SQL or an unbounded action. @internal */
export function command(value: unknown): IWorkerCommand {
  if (!isRecord(value) || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || typeof value.action !== 'string') { throw new TypeError('Invalid experiment command'); }
  const action = actions.find(candidate => candidate === value.action);
  if (action === undefined || value.revision !== undefined && (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 4)) { throw new TypeError('Unsupported experiment command'); }
  return { id: value.id, action, ...(typeof value.revision === 'number' ? { revision: value.revision } : {}) };
}
/** Native rows must supply the finite fixture scalar domain. @internal */
export function pair(value: unknown): ICorrelatedPair {
  if (!isRecord(value) || typeof value.revision !== 'number' || typeof value.currentRevision !== 'number' || typeof value.value !== 'string') { throw new TypeError('Invalid correlated pair'); }
  return { revision: value.revision, currentRevision: value.currentRevision, value: value.value };
}
/** Runtime pins are read from the loaded driver; no header-derived defaults can fill an absent fact. */
function runtime(value: unknown): IRuntimePins {
  if (!isRecord(value) || typeof value.node !== 'string' || typeof value.driver !== 'string' || typeof value.sqlite !== 'string'
    || typeof value.platform !== 'string' || typeof value.arch !== 'string' || !Array.isArray(value.compileOptions)
    || !value.compileOptions.every((entry: unknown) => typeof entry === 'string')) { throw new TypeError('Invalid loaded runtime pins'); }
  return { node: value.node, driver: value.driver, sqlite: value.sqlite, platform: value.platform, arch: value.arch,
    compileOptions: value.compileOptions.filter((entry: unknown): entry is string => typeof entry === 'string'),
    ...(typeof value.sqliteSourceId === 'string' ? { sqliteSourceId: value.sqliteSourceId } : {}),
    ...(typeof value.driverEntry === 'string' ? { driverEntry: value.driverEntry } : {}) };
}
/** Error fields describe native host facts without reconstructing JavaScript error identity across JSON. */
function failure(value: unknown): IObservedFailure {
  if (!isRecord(value) || value.origin !== 'candidate' && value.origin !== 'infrastructure' || typeof value.stage !== 'string'
    || value.code !== null && typeof value.code !== 'string' || typeof value.message !== 'string') { throw new TypeError('Invalid native failure'); }
  return { origin: value.origin, stage: value.stage, code: value.code, message: value.message };
}
/** Every response is checked before it can count as an acknowledgment, value or failure. @internal */
export function reply(value: unknown): IWorkerReply {
  if (!isRecord(value) || typeof value.id !== 'number' || !Number.isSafeInteger(value.id)) { throw new TypeError('Invalid worker response'); }
  const id = value.id;
  switch (value.kind) {
    case 'opened': return { id, kind: 'opened', runtime: value.runtime === null ? null : runtime(value.runtime) };
    case 'runtime': return { id, kind: 'runtime', runtime: runtime(value.runtime) };
    case 'initialized': case 'begun': case 'ended': case 'closed': case 'exiting': case 'reserved': case 'released': return { id, kind: value.kind };
    case 'committed': case 'anchored': case 'pair': return { id, kind: value.kind, pair: pair(value.pair) };
    case 'meta': if (typeof value.revision === 'number') { return { id, kind: 'meta', revision: value.revision }; } break;
    case 'current': if (typeof value.currentRevision === 'number' && typeof value.value === 'string') { return { id, kind: 'current', currentRevision: value.currentRevision, value: value.value }; } break;
    case 'checkpoint': if (Array.isArray(value.result)) { return { id, kind: 'checkpoint', result: value.result }; } break;
    case 'failed': if (Array.isArray(value.cleanup)) { return { id, kind: 'failed', failure: failure(value.failure), cleanup: value.cleanup.map(failure) }; } break;
  }
  throw new TypeError('Unsupported worker response');
}
