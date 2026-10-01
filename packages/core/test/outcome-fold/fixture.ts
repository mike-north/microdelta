/**
 * The outcome-fold authoring fixture: the contribution population reduced to
 * one keyed, gated template, with both a strict fold and an outcome
 * (tolerant) fold over its member summaries, written as an author writes it
 * against Definition's builders bound to the facade's authoring family.
 *
 * - `contributors` is a composition-level keyed collection source over the
 *   roster the fixture world holds (the stand-in for an external service);
 *   its finality hook reports the world's current answer, and the roster
 *   carries its own completion status.
 * - `contributor` is a template over that collection with one member memo,
 *   `summary`, that reads its member's `login` and `score`. Its gate requires
 *   a member when `authored` reaches `config.minimumAuthored` (default 1).
 *   A summary fails, as an author error, for a login the world lists in
 *   `failSummary`; its failure message and its output carry the world's
 *   planted marker, a value that must never reach an event.
 * - `tally` is the outcome fold over `contributor.summary`. Its body receives
 *   every member's settled status, logs them, and returns per-status counts
 *   plus the total score of the succeeded entries (it consumes `score` only,
 *   never `label`).
 * - `report` is a strict fold over the same step, used to show the two
 *   contracts never share results.
 *
 * In-process tests may hold a member's summary open (`hold`) until they
 * release it, to stop a run while that summary is executing. Holds are not
 * part of the JSON world, so worker processes never use them.
 *
 * Every `composeTally` call allocates fresh declarations, callbacks and
 * inputs, standing in for a new process; `order: 'reversed'` registers
 * helpers, steps and templates in reverse.
 *
 * Hand-derived data: Ada authored 3, Ben 2 and Cy 1, with scores 5, 3 and 2;
 * Dee (inserted by some cases) authored 4 with score 4. At the default
 * threshold every member is required; at threshold 2 Cy is skipped.
 *
 * @see ../../../../docs/spec/operations.md (RUN-010 and its owner decision)
 * @see ../../../../docs/plans/m5-operations.md (Folds; outcome-fold-coverage)
 */
import { declarations } from '@microdelta/definition';
import type { IFoldEntry, IMemberBuilder, IOutcomeEntry } from '@microdelta/definition';

import { sourceOutcome } from '../../src/index.js';
import type { IAuthoring, IAuthoringFamily, IComposition, ISourceOutcome, IStepDescriptor, ITrackedView } from '../../src/index.js';

/** The analysis scope of the fixture composition. */
export const analysis = 'contribution-report:acme/widget:outcome-fold';

/** The outcome fold's scoped subject. */
export const tallySubject = 'tally:acme/widget:2026-Q1';

/** The strict fold's scoped subject. */
export const reportSubject = 'report:acme/widget:2026-Q1';

/** One discovered contributor record. */
export interface IContributor {
  /** Designated identity. */
  readonly key: string;
  /** Consumed by the gate and the summary. */
  readonly login: string;
  /** Consumed by the gate only. */
  readonly authored: number;
  /** Consumed by the summary; the only member fact the folds consume, through the summary. */
  readonly score: number;
}

/** The discovery result: members and completion status. */
export interface IRoster {
  readonly members: readonly IContributor[];
  readonly status: 'complete' | 'open';
}

/** A member summary. The folds consume only `score`; `label` carries the planted marker. */
export interface ISummary {
  readonly label: string;
  readonly score: number;
}

/** The outcome fold's result: per-status counts and the succeeded members' total score. */
export interface ITally {
  readonly succeeded: number;
  readonly skipped: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly total: number;
}

/** The strict fold's result. */
export interface IReport {
  readonly total: number;
}

/** The gate's tracked configuration. */
export interface IConfig {
  readonly minimumAuthored: number;
}

/** The declared input record. */
export interface IInputs {
  readonly config: IConfig;
}

/** The entries the outcome fold receives. */
export type ITallyEntries = readonly IOutcomeEntry<ITrackedView<ISummary>>[];

/** The entries the strict fold receives. */
export type IReportEntries = readonly IFoldEntry<ITrackedView<ISummary>>[];

/** The declared helper record. */
export interface IHelpers {
  readonly discover: () => ISourceOutcome<IRoster>;
  readonly discoveryFinal: () => boolean;
  readonly meets: (login: string, authored: number, minimum: number) => boolean;
  readonly summarize: (login: string, score: number) => ISummary | Promise<ISummary>;
  readonly tally: (entries: ITallyEntries) => ITally;
  readonly report: (entries: IReportEntries) => IReport;
}

/** An admission decision the fixture policy returns. */
export type IDecision = 'denied' | 'cancelled';

/**
 * The fixture world: remote data, policy answers and the ordered helper log.
 * Plain JSON, so a worker process can load it.
 */
export interface IWorld {
  /** The roster discovery returns, in discovery order. */
  roster: IRoster;
  /** Whether discovery's finality accepts its eligible previous result. */
  discoveryFinal: boolean;
  /** Logins whose summary fails. */
  failSummary: string[];
  /**
   * Admission decisions: by member key for that member's summary instance,
   * `@tally` and `@report` for each fold's own work and `@contributors` for
   * discovery.
   */
  decisions: Record<string, IDecision>;
  /** A marker planted in every summary's output and failure message; it must never reach an event. */
  plant: string;
  /**
   * Every helper call, in order: `discover`, `gate:<login>`,
   * `summary:<login>`, `tally:<key>=<status>,...` and
   * `report:<key>=<status>,...` with the entries each fold body received.
   */
  log: string[];
}

/** Ada, Ben and Cy as discovered for acme/widget in 2026-Q1. */
export function contributors(): IContributor[] {
  return [
    { key: 'person:ada', login: 'ada', authored: 3, score: 5 },
    { key: 'person:ben', login: 'ben', authored: 2, score: 3 },
    { key: 'person:cy', login: 'cy', authored: 1, score: 2 },
  ];
}

/** Dee, inserted by some cases. */
export function dee(): IContributor {
  return { key: 'person:dee', login: 'dee', authored: 4, score: 4 };
}

/** The marker every fresh world plants. */
export const plantedMarker = 'PLANTED-c0ffee-value';

/** A fresh world: a complete roster of Ada, Ben and Cy, discovery accepted by finality, an empty log. */
export function createWorld(members: readonly IContributor[] = contributors(), status: IRoster['status'] = 'complete'): IWorld {
  return { roster: { members: [...members], status }, discoveryFinal: true, failSummary: [], decisions: {}, plant: plantedMarker, log: [] };
}

/** The world the fixture helpers read; each test (or worker process) installs its own. */
export let world: IWorld = createWorld();

/** Install a world, fresh by default. */
export function resetWorld(next: IWorld = createWorld()): IWorld {
  world = next;
  return world;
}

/** In-process holds: a held login's summary waits until the test releases it. */
const holds = new Map<string, { readonly released: Promise<void>; readonly release: () => void }>();

/** Hold the summary of `login` open until {@link release} is called for it. */
export function hold(login: string): void {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  holds.set(login, { released, release });
}

/** Release a held summary. */
export function release(login: string): void {
  holds.get(login)?.release();
}

/** Drop every hold. */
export function clearHolds(): void {
  for (const held of holds.values()) {
    held.release();
  }
  holds.clear();
}

/** JSON copy of remote data, so no stored result shares a container with the world. */
function copy<T>(value: T): T {
  // The world is plain JSON by construction; the copy has the same shape.
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The discovery adapter: always fresh remote data. */
function discover(): ISourceOutcome<IRoster> {
  world.log.push('discover');
  return sourceOutcome.fresh(copy(world.roster));
}

/** The discovery finality policy: the world's current answer. */
function discoveryFinal(): boolean {
  return world.discoveryFinal;
}

/** The gate predicate: authored work reaches the threshold. */
function meets(login: string, authored: number, minimum: number): boolean {
  world.log.push(`gate:${login}`);
  return authored >= minimum;
}

/** The member summary, the configured failure of it, or (when held) the summary once released. */
function summarize(login: string, score: number): ISummary | Promise<ISummary> {
  world.log.push(`summary:${login}`);
  if (world.failSummary.includes(login)) {
    throw new Error(`summary service failed for ${login}: ${world.plant}`);
  }
  const summary = { label: `@${login} ${world.plant}`, score };
  const held = holds.get(login);
  return held === undefined ? summary : held.released.then(() => summary);
}

/** The outcome fold body: per-status counts and the succeeded total, consuming `score` only. */
function tally(entries: ITallyEntries): ITally {
  world.log.push(`tally:${entries.map((entry) => `${entry.key}=${entry.status}`).join(',')}`);
  const counts = { succeeded: 0, skipped: 0, failed: 0, cancelled: 0, total: 0 };
  for (const entry of entries) {
    counts[entry.status] += 1;
    if (entry.status === 'succeeded') {
      counts.total += entry.data.score;
    }
  }
  return counts;
}

/** The strict fold body: the total score of its required members. */
function report(entries: IReportEntries): IReport {
  world.log.push(`report:${entries.map((entry) => `${entry.key}=${entry.status}`).join(',')}`);
  return { total: entries.reduce((sum, entry) => sum + (entry.status === 'succeeded' ? entry.data.score : 0), 0) };
}

/** Author-visible variations of one fixture build. */
export interface IVariation {
  /** Registration order of helpers, steps and templates. */
  readonly order?: 'forward' | 'reversed';
  /** The gate threshold input. */
  readonly minimumAuthored?: number;
}

/** One fresh composition with its builders and the descriptors tests use. */
export interface ITallyFixture {
  readonly builders: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  /** The outcome fold's composition-level step. */
  readonly tally: IStepDescriptor;
  /** The strict fold's composition-level step. */
  readonly report: IStepDescriptor;
}

/** Order a registration list by the variation. */
function ordered<T>(items: readonly T[], variation: IVariation): T[] {
  return variation.order === 'reversed' ? [...items].reverse() : [...items];
}

/** Compose the outcome-fold fixture with fresh allocations. */
export function composeTally(variation: IVariation = {}): ITallyFixture {
  const builders: IAuthoring<IInputs, IHelpers> = declarations<IAuthoringFamily<IInputs, IHelpers>>();
  const { source, template, fold, outcomeFold, compose } = builders;

  const roster = source<IRoster>({
    subject: 'contributors:acme/widget:2026-Q1',
    collection: { identity: 'key' },
    finality: ({ helpers }) => helpers.discoveryFinal(),
    run: ({ helpers }) => helpers.discover(),
  });
  const steps = (member: IMemberBuilder<IAuthoringFamily<IInputs, IHelpers>, IContributor>) => ({
    summary: member.memo({
      subject: member.subject('summary:acme/widget:2026-Q1'),
      run: ({ member: bound, helpers }) => helpers.summarize(bound.login, bound.score),
    }),
  });
  const contributor = template({
    slot: 'contributor',
    collection: roster,
    gate: ({ member, inputs, helpers }) => helpers.meets(member.login, member.authored, inputs.config.minimumAuthored),
    steps,
  });
  const over = { template: contributor, step: 'summary' } as const;
  const tallyFold = outcomeFold({ subject: tallySubject, over, run: ({ members, helpers }) => helpers.tally(members) });
  const reportFold = fold({ subject: reportSubject, over, run: ({ members, helpers }) => helpers.report(members) });

  const inputs = [{ slot: 'config', value: { minimumAuthored: variation.minimumAuthored ?? 1 } }];
  const helpers = ordered([
    { slot: 'discover', helper: discover },
    { slot: 'discoveryFinal', helper: discoveryFinal },
    { slot: 'meets', helper: meets },
    { slot: 'summarize', helper: summarize },
    { slot: 'tally', helper: tally },
    { slot: 'report', helper: report },
  ], variation);
  const compositionSteps = ordered([
    { slot: 'contributors', declaration: roster },
    { slot: 'tally', declaration: tallyFold },
    { slot: 'report', declaration: reportFold },
  ], variation);
  const composition = compose({ scope: analysis, inputs, helpers, steps: compositionSteps, templates: [contributor] });
  return {
    builders,
    composition,
    tally: Object.freeze({ scope: analysis, role: 'step', slot: 'tally' }),
    report: Object.freeze({ scope: analysis, role: 'step', slot: 'report' }),
  };
}
