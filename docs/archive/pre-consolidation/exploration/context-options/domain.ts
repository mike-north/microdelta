/** Application types and integration boundaries, not framework exports. @internal */
import type { Environment, Observation, Preview } from './surface.js';

/** Directory metadata is cheap enough to select before contribution retrieval. @internal */
export interface Employee {
  readonly id: string;
  readonly name: string;
  readonly lastName: string;
  readonly role: string;
}
/** Team membership is an explicit input to team aggregation. @internal */
export interface Team {
  readonly id: string;
  readonly name: string;
  readonly employees: readonly Employee[];
}
/** The prompt is a versioned input, not hidden mutable environment configuration. @internal */
export interface Rubric { readonly prompt: string }
/** One invocation's semantic inputs. @internal */
export interface Input {
  readonly organization: string;
  readonly period: string;
  readonly rubric: Rubric;
}
/** Stable discovery identity; full facts are fetched separately. @internal */
export interface PullRequest { readonly id: string }
/** Text is needed for judgment, but not for the histogram projection. @internal */
export interface Fact {
  readonly id: string;
  readonly text: string;
  readonly language: string;
  readonly changedLines: number;
}
/** Compact projection keeps histogram iteration away from full PR text. @internal */
export interface ChartPoint { readonly language: string; readonly changedLines: number }
/** The distribution is intentionally a simple application calculation. @internal */
export type Histogram = Readonly<Record<string, number>>;
/** Small structured model output used in team reports. @internal */
export interface Judgment { readonly summary: string; readonly score: number }
/** Useful scope labels travel with results, not just transient terminal output. @internal */
export interface Assessment extends Judgment { readonly employeeId: string; readonly name: string }
/** Both outputs share the same person's fact collection. @internal */
export interface PersonReport { readonly assessment: Assessment; readonly histogram: Histogram }
/** A tolerant team report retains explicit failure counts. @internal */
export interface TeamReport {
  readonly teamId: string;
  readonly name: string;
  readonly selectedPeople: number;
  readonly failures: readonly { readonly employeeKey: string; readonly message: string }[];
  readonly people: readonly PersonReport[];
}
/** A complete result for a selected population is not necessarily a complete organization. @internal */
export interface Report { readonly environment: string; readonly teams: readonly TeamReport[] }
/** Integration callbacks emit observed increments, once per actual provider observation. @internal */
export interface RequestOptions {
  readonly signal: AbortSignal;
  readonly onUsage: (observation: Observation) => void;
}
/** Application/provider adapters: no implementation or network access in these examples. @internal */
export interface Services {
  directory(organization: string, options: RequestOptions): Promise<readonly Team[]>;
  pullRequests(employeeId: string, period: string, options: RequestOptions): AsyncIterable<PullRequest>;
  fact(id: string, options: RequestOptions): Promise<Fact>;
  judge(input: { readonly name: string; readonly evidence: readonly string[]; readonly prompt: string }, options: RequestOptions): Promise<Judgment>;
}
/** Deployment owns credential loading and clients; this comparison does not invent a loader. @internal */
export declare function configure(environment: string): Environment<Services>;
/** Viewer preserves the complete preview envelope, including errors and missing values. @internal */
export declare function renderHistogram(state: Preview<Histogram>, instance: { readonly key: string }): void;
/** CLI integration is a boundary; these examples do not implement a renderer. @internal */
export declare function showPlan(text: string): void;
/** Delivery/serialization is application-owned; outputs are environment-specific. @internal */
export declare function saveReport(report: Report, environment: string): Promise<void>;
