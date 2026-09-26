/** Application data and adapter contracts for the example, not Microdelta exports. @internal */
import type { IObservation } from './surface.js';

/** UTC instants; this example selects PRs created in [start, end). @internal */
export interface IWindow { readonly start: string; readonly end: string }
/** Explicit policy input: changing it must change the next finality evaluation. @internal */
export interface ISourcePolicy { readonly acceptMergedAsFinal: boolean }
/** Roster identity is independent of display order and GitHub username. @internal */
export interface IEmployee { readonly employeeId: string; readonly name: string; readonly githubUsername: string }
/** Discovery returns references, not full PR evidence. @internal */
export interface IPRReference { readonly url: string; readonly createdAt: string }
/** Null continuation means successful exhaustion; an empty items array does not. @internal */
export interface IPRPage { readonly items: readonly IPRReference[]; readonly next: string | null }
/** Adapter-issued validators cover each evidence component, not just the PR resource. @internal */
export interface IEvidenceVersion { readonly details: string; readonly diff: string; readonly reviews: string }
/** Accepted complete snapshot; no finality flag is stored in this data. @internal */
export interface IPRData extends IPRReference {
  readonly merged: boolean;
  readonly title: string;
  readonly body: string;
  readonly diff: string;
  readonly reviews: readonly string[];
  readonly version: IEvidenceVersion;
}
/** Structured, validated per-PR complexity judgment. @internal */
export interface IJudgment { readonly score: number; readonly summary: string }
/** Person-independent assessment permits reuse across discovery occurrences. @internal */
export interface IAssessment extends IJudgment { readonly url: string }
/** One complete summary per selected roster row, including the closed-zero-PR case. @internal */
export interface IPersonSummary {
  readonly employeeId: string;
  readonly name: string;
  readonly githubUsername: string;
  readonly window: IWindow;
  readonly pullRequestCount: number;
  readonly meanComplexity: number | null;
  readonly summary: string;
}
/** Analysis inputs are explicit dependencies, including both prompts and model. @internal */
export interface IInput {
  readonly organizationId: string;
  readonly window: IWindow;
  readonly sourcePolicy: ISourcePolicy;
  readonly complexityPrompt: string;
  readonly summaryPrompt: string;
  readonly model: string;
  readonly trialEmployeeIds: readonly string[];
}
/** An artifact labels its selected population; it does not imply full-organization coverage. @internal */
export interface IReport { readonly environment: string; readonly people: readonly IPersonSummary[] }
/** Adapters report observed increments once and propagate cooperative cancellation. @internal */
export interface IRequestOptions {
  readonly signal: AbortSignal;
  readonly onUsage: (observation: IObservation) => void;
}
/** Complete snapshot reads must honor an optional expected component version. @internal */
export interface IPRReader {
  inspect(url: string, options: IRequestOptions): Promise<IEvidenceVersion>;
  fetch(url: string, options: IRequestOptions, expected?: IEvidenceVersion): Promise<IPRData>;
}
/** Provider boundaries are deliberately injected; no real endpoints or credentials are invented. @internal */
export interface IServices {
  rosterCsv(organizationId: string, options: IRequestOptions): Promise<string>;
  /** Use a real CSV parser with quoted fields/newlines and required-column validation. */
  parseRosterCsv(csv: string): readonly IEmployee[];
  page(username: string, window: IWindow, cursor: string | undefined, options: IRequestOptions): Promise<IPRPage>;
  readonly pr: IPRReader;
  judge(input: { readonly title: string; readonly body: string; readonly diff: string; readonly reviews: readonly string[]; readonly prompt: string; readonly model: string }, options: IRequestOptions): Promise<unknown>;
  summarize(input: { readonly employee: IEmployee; readonly window: IWindow; readonly assessments: readonly IAssessment[]; readonly prompt: string; readonly model: string }, options: IRequestOptions): Promise<unknown>;
}
