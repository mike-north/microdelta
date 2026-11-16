/** Checked JSON protocol for independent-process source-call acceptance. */
import type { ICompletedResultReference } from 'microdelta';
import type { IDetail, IPerson, IPrompt, ISearch, IVariation, IWorld } from './fixture.js';

/** Only durable History and this controlled remote state cross process exits. */
export interface IJob {
  readonly location: string;
  readonly requestKey: string;
  readonly world: IWorld;
  readonly variation: IVariation;
}
/** Exported summaries contain application values, never tracked wrappers. */
export interface IReportData { readonly people: readonly { readonly key: string; readonly count: number; readonly total: number }[] }
/** Each person retains its independent completion and exact reference boundary. */
export interface IMemberReport { readonly key: string; readonly status: string; readonly reference?: ICompletedResultReference }
/** Worker evidence distinguishes source work, person results and outer strictness. */
export interface IWorkerReport {
  readonly status: string;
  readonly members: readonly IMemberReport[];
  readonly trace: readonly string[];
  readonly data?: IReportData;
}
/** JSON objects are checked before any protocol-specific field is used. */
function record(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** Only ordinary strings pass an ID/trace field's transport boundary. */
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string'); }
/** A completion certificate's semantic validity is checked by the search adapter. */
function search(value: unknown): value is ISearch { return record(value) && typeof value.count === 'number' && strings(value.ids); }
/** Remote detail shape is independent of source acceptance policy. */
function detail(value: unknown): value is IDetail { return record(value) && typeof value.id === 'string' && typeof value.merged === 'boolean' && typeof value.title === 'string'; }
/** The selected roster carries author argument values independently of membership. */
function person(value: unknown): value is IPerson { return record(value) && typeof value.key === 'string' && typeof value.argument === 'string'; }
/** Prompts are separately forwarded application input. */
function prompt(value: unknown): value is IPrompt { return record(value) && typeof value.weight === 'number' && typeof value.text === 'string'; }
/** Validate every controlled fixture world field that author helpers may inspect. */
function world(value: unknown): value is IWorld {
  return record(value) && record(value.searches) && Object.values(value.searches).every(search)
    && record(value.details) && Object.values(value.details).every(detail)
    && record(value.accepts) && Object.values(value.accepts).every(item => typeof item === 'boolean') && strings(value.trace)
    && (value.searchFailures === undefined || (record(value.searchFailures) && Object.values(value.searchFailures).every(item => item === 'failed' || item === 'truncated')))
    && (value.detailFailures === undefined || strings(value.detailFailures)) && (value.retain === undefined || typeof value.retain === 'boolean');
}
/** Variation controls are bounded to the fixture's supported compatibility cases. */
function variation(value: unknown): value is IVariation {
  return record(value) && (value.selected === undefined || (Array.isArray(value.selected) && value.selected.every(person)))
    && (value.prompt === undefined || prompt(value.prompt))
    && (value.policy === undefined || (record(value.policy) && typeof value.policy.binding === 'string' && typeof value.policy.revision === 'number'))
    && (value.implementation === undefined || value.implementation === 'original' || value.implementation === 'revised')
    && (value.supplied === undefined || value.supplied === 'once' || value.supplied === 'none' || value.supplied === 'twice')
    && (value.argumentMode === undefined || value.argumentMode === 'tracked' || value.argumentMode === 'untracked' || value.argumentMode === 'opaque')
    && (value.sourceSubject === undefined || value.sourceSubject === 'detail' || value.sourceSubject === 'assessment')
    && (value.sourceSlot === undefined || typeof value.sourceSlot === 'string')
    && (value.consumeArgument === undefined || typeof value.consumeArgument === 'boolean')
    && (value.order === undefined || value.order === 'forward' || value.order === 'reverse');
}
/** Narrow one worker job without trusting JSON.parse's untyped result. */
export function isJob(value: unknown): value is IJob { return record(value) && typeof value.location === 'string' && typeof value.requestKey === 'string' && world(value.world) && variation(value.variation); }
/** An exact reference names historical content, never a current pointer. */
function reference(value: unknown): value is ICompletedResultReference { return record(value) && value.kind === 'completed-result' && typeof value.locator === 'string'; }
/** Validate exported member evidence before comparing its exact references. */
function member(value: unknown): value is IMemberReport { return record(value) && typeof value.key === 'string' && typeof value.status === 'string' && (value.reference === undefined || reference(value.reference)); }
/** Only successful outer results carry the application's strict report. */
function data(value: unknown): value is IReportData {
  return record(value) && Array.isArray(value.people) && value.people.every((person: unknown) => record(person) && typeof person.key === 'string' && typeof person.count === 'number' && typeof person.total === 'number');
}
/** Narrow a worker's claimed outcome before using it as acceptance evidence. */
export function isWorkerReport(value: unknown): value is IWorkerReport { return record(value) && typeof value.status === 'string' && Array.isArray(value.members) && value.members.every(member) && strings(value.trace) && (value.data === undefined || data(value.data)); }
