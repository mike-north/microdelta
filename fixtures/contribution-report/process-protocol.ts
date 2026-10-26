/** Checked transport for complete process exits; no callback or coordinator state crosses this boundary. */
import type { ICompletedResultReference } from 'microdelta';
import type { IControlledReport, IReportInputs } from '../../examples/contribution-report/src/controlled/application.js';
import { isRecord } from '../../examples/contribution-report/src/controlled/github.js';
import type { IFixtureOptions } from './fixture.js';

/** Serializable provider variations change only independently controlled wire/content data. */
export type IProcessOptions = Pick<IFixtureOptions, 'ids' | 'merged' | 'label' | 'diff' | 'searchPageSize'>;
/** Durable files and current input are the only state shared by independent workers. */
export interface IProcessJob { readonly directory: string; readonly requestKey: string; readonly inputs: IReportInputs; readonly options: IProcessOptions; readonly environment?: string; readonly mode?: 'normal' | 'fail-grace' | 'crash-after-ada' }
/** Workers report person boundaries independently of strict aggregate completion. */
export interface IProcessReport { readonly status: 'complete' | 'incomplete'; readonly people: readonly { readonly key: string; readonly status: string; readonly reference?: ICompletedResultReference }[]; readonly trace: readonly string[]; readonly requests: number; readonly assessments: number; readonly usage: { readonly attempts: number; readonly reports: number; readonly unknown: number; readonly tokens: number }; readonly report?: IControlledReport }
/** Arrays crossing JSON carry only their declared scalar domain. */
function strings(value: unknown): value is readonly string[] { return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string'); }
/** Keep narrowed object identity stable across the field-check callback. */
function numericFields(value: unknown, keys: readonly string[]): boolean { return isRecord(value) && keys.every(key => typeof value[key] === 'number'); }
/** Validate every input property subsequently read by the application. */
function inputs(value: unknown): value is IReportInputs {
  return isRecord(value) && typeof value.csv === 'string' && strings(value.selected) && isRecord(value.scope) && strings(value.scope.repositories)
    && numericFields(value.scope, ['start', 'end', 'cutoff']) && typeof value.scope.observation === 'string'
    && isRecord(value.prompt) && typeof value.prompt.text === 'string' && typeof value.prompt.model === 'string' && typeof value.prompt.weight === 'number' && typeof value.prompt.helperVersion === 'string'
    && isRecord(value.settling) && typeof value.settling.quietSeconds === 'number' && typeof value.settling.quietVersion === 'string' && typeof value.settling.closedDay === 'string' && typeof value.settling.dailyVersion === 'string'
    && (value.assessmentContexts === undefined || isRecord(value.assessmentContexts) && Object.values(value.assessmentContexts).every(entry => typeof entry === 'string'))
    && (value.contentBasis === undefined || isRecord(value.contentBasis) && (value.contentBasis.kind === 'unverified' || value.contentBasis.kind === 'controlled-as-of' && typeof value.contentBasis.scenario === 'string' && typeof value.contentBasis.cutoff === 'number'));
}
/** Only supported provider test variations may enter an independent worker. */
function options(value: unknown): value is IProcessOptions {
  return isRecord(value) && (value.ids === undefined || isRecord(value.ids) && Object.values(value.ids).every(entries => Array.isArray(entries) && entries.every((entry: unknown) => typeof entry === 'number')))
    && (value.merged === undefined || Array.isArray(value.merged) && value.merged.every((entry: unknown) => typeof entry === 'number'))
    && (value.label === undefined || typeof value.label === 'string') && (value.diff === undefined || typeof value.diff === 'string') && (value.searchPageSize === undefined || typeof value.searchPageSize === 'number');
}
/** Narrow the job before choosing files, report scope or remote behavior. */
export function isProcessJob(value: unknown): value is IProcessJob { return isRecord(value) && typeof value.directory === 'string' && typeof value.requestKey === 'string' && inputs(value.inputs) && options(value.options) && (value.environment === undefined || typeof value.environment === 'string') && (value.mode === undefined || value.mode === 'normal' || value.mode === 'fail-grace' || value.mode === 'crash-after-ada'); }
/** Exact locator spelling comes from the durable framework result, never a current pointer. */
function reference(value: unknown): value is ICompletedResultReference { return isRecord(value) && value.kind === 'completed-result' && typeof value.locator === 'string'; }
/** Successful report payloads preserve their concrete fixed-scenario population. */
function report(value: unknown): value is IControlledReport {
  return isRecord(value) && value.population === 'authored-prs' && value.coverageBasis === 'fixed-controlled-dataset' && strings(value.selected) && isRecord(value.scope)
    && Array.isArray(value.people) && value.people.every((person: unknown) => isRecord(person) && typeof person.key === 'string' && typeof person.name === 'string' && typeof person.count === 'number' && typeof person.score === 'number' && (person.status === 'contributions' || person.status === 'no-contributions'));
}
/** Validate every exported worker fact used by acceptance comparisons. */
export function isProcessReport(value: unknown): value is IProcessReport {
  return isRecord(value) && (value.status === 'complete' || value.status === 'incomplete') && strings(value.trace) && typeof value.requests === 'number' && typeof value.assessments === 'number'
    && numericFields(value.usage, ['attempts', 'reports', 'unknown', 'tokens'])
    && Array.isArray(value.people) && value.people.every((person: unknown) => isRecord(person) && typeof person.key === 'string' && typeof person.status === 'string' && (person.reference === undefined || reference(person.reference)))
    && (value.report === undefined || report(value.report));
}
