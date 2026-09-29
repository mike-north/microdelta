/**
 * The strict-fold authoring fixture: the contribution population reduced to
 * one keyed, gated template and one strict fold over its member summaries,
 * written as an author writes it against Definition's builders bound to the
 * facade's authoring family (exactly what the facade's `authoring()` returns,
 * created through Definition's generated declaration so the tracked-captures
 * lint recognizes the builder factory).
 *
 * - `contributors` is a composition-level keyed collection source over the
 *   roster the fixture world holds (the stand-in for an external service);
 *   its finality hook reports the world's current answer, so a test decides
 *   when discovery must run its check again, and the roster carries its own
 *   completion status.
 * - `contributor` is a template over that collection with one member step,
 *   `summary`, a member memo that reads its member's `login` and `score`
 *   through the member binding. The gate requires a member when its
 *   `authored` count reaches the tracked input `config.minimumAuthored`
 *   (default 1). No member work reads `bio` or `id`, and the summary never
 *   reads `authored`.
 * - `report` is a strict fold over `contributor.summary`. Its body consumes
 *   each succeeded entry's `score` only, never `label`. The default body lists
 *   every member, skipped ones as excluded by the gate; the `omits-skipped`
 *   body lists only succeeded members (so the framework's coverage, not the
 *   body, must report exclusions); the `reads-skipped` body reads a skipped
 *   entry's data, which strict fold entries forbid.
 *
 * Every `composeFold` call allocates fresh declarations, callbacks and
 * inputs, standing in for a new process; `order: 'reversed'` registers
 * helpers, steps and templates in reverse. The declared helpers each callback
 * calls keep the event log, so callbacks capture nothing but their typed
 * context.
 *
 * Hand-derived expectations (docs/plans/m4-composition.md, concrete fixture
 * decisions): Ada authored 3, Ben 2 and Cy 1, with scores 5, 3 and 2. At the
 * default threshold 1 every member is required and the report total is 10;
 * at threshold 2 Cy is skipped and the total is 8; threshold 0 selects the
 * same population as threshold 1. Each summary is `{ label: '@<login>',
 * score: <score> }`.
 *
 * @see ../../../../docs/plans/m4-composition.md ("Strict fold", concrete fixture decisions)
 * @see ../../../../docs/spec/composition.md (CMP-8 and its EXP-4 strict-fold selection)
 * @see ../../../../docs/spec/operations.md (RUN-004, RUN-005, RUN-010)
 */
import { declarations } from '@microdelta/definition';
import type { IFoldEntry, IMemberBuilder } from '@microdelta/definition';

import { sourceOutcome } from '../../src/index.js';
import type { IAuthoring, IAuthoringFamily, IComposition, ISourceOutcome, IStepDescriptor, ITrackedView } from '../../src/index.js';

/** The analysis scope of the fixture composition. */
export const analysis = 'contribution-report:acme/widget:fold';

/** The fold's scoped subject. */
export const reportSubject = 'report:acme/widget:2026-Q1';

/** One discovered contributor record. */
export interface IContributor {
  /** Designated identity. */
  readonly key: string;
  /** Upstream profile id; never read. */
  readonly id: string;
  /** Consumed by the gate and the summary. */
  readonly login: string;
  /** Consumed by the gate only. */
  readonly authored: number;
  /** Consumed by the summary; the only member fact the report consumes, through the summary. */
  readonly score: number;
  /** Never read by any member work. */
  readonly bio: string;
}

/** The discovery result: members and completion status. */
export interface IRoster {
  readonly members: readonly IContributor[];
  readonly status: 'complete' | 'open';
}

/** A member summary. The report consumes only `score`. */
export interface ISummary {
  readonly label: string;
  readonly score: number;
}

/** The strict fold's result. */
export interface IReport {
  readonly lines: readonly string[];
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

/** The keyed entries a strict fold over the summaries receives. */
export type ISummaryEntries = readonly IFoldEntry<ITrackedView<ISummary>>[];

/** The declared helper record. */
export interface IHelpers {
  readonly discover: () => ISourceOutcome<IRoster>;
  readonly discoveryFinal: () => boolean;
  readonly meets: (login: string, authored: number, minimum: number) => boolean;
  readonly summarize: (login: string, score: number) => ISummary;
  readonly render: (entries: ISummaryEntries) => IReport;
  readonly renderIncluded: (entries: ISummaryEntries) => IReport;
  readonly renderReadingSkipped: (entries: ISummaryEntries) => IReport;
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
   * `@report` for the fold's own work and `@contributors` for discovery.
   */
  decisions: Record<string, IDecision>;
  /** Admission targets (named as for `decisions`) for which the admission port itself fails: an outage, not a decision. */
  admissionFaults: string[];
  /**
   * Every helper call, in order: `discover`, `gate:<login>`,
   * `summary:<login>`, and `report:<key>=<status>,...` with the entries the
   * fold body received.
   */
  log: string[];
}

/** Ada, Ben and Cy as discovered for acme/widget in 2026-Q1. */
export function contributors(): IContributor[] {
  return [
    { key: 'person:ada', id: 'gh:1001', login: 'ada', authored: 3, score: 5, bio: 'Parser work' },
    { key: 'person:ben', id: 'gh:1002', login: 'ben', authored: 2, score: 3, bio: 'Docs' },
    { key: 'person:cy', id: 'gh:1003', login: 'cy', authored: 1, score: 2, bio: 'First PR' },
  ];
}

/** Dee, inserted by the insertion and A-11 cases. */
export function dee(): IContributor {
  return { key: 'person:dee', id: 'gh:1004', login: 'dee', authored: 4, score: 4, bio: 'New' };
}

/** A fresh world: a complete roster of Ada, Ben and Cy, discovery accepted by finality, an empty log. */
export function createWorld(members: readonly IContributor[] = contributors(), status: IRoster['status'] = 'complete'): IWorld {
  return { roster: { members: [...members], status }, discoveryFinal: true, failSummary: [], decisions: {}, admissionFaults: [], log: [] };
}

/** The world the fixture helpers read; each test (or worker process) installs its own. */
export let world: IWorld = createWorld();

/** Install a world, fresh by default. */
export function resetWorld(next: IWorld = createWorld()): IWorld {
  world = next;
  return world;
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

/** The member summary, or the configured failure of it. */
function summarize(login: string, score: number): ISummary {
  world.log.push(`summary:${login}`);
  if (world.failSummary.includes(login)) {
    throw new Error(`summary service failed for ${login}`);
  }
  return { label: `@${login}`, score };
}

/** Log the entries a fold body received, as `report:<key>=<status>,...`. */
function logEntries(entries: ISummaryEntries): void {
  world.log.push(`report:${entries.map((entry) => `${entry.key}=${entry.status}`).join(',')}`);
}

/** The report: every member in entry order, skipped members listed as excluded by the gate; consumes `score` only. */
function render(entries: ISummaryEntries): IReport {
  logEntries(entries);
  const lines: string[] = [];
  let total = 0;
  for (const entry of entries) {
    if (entry.status === 'succeeded') {
      lines.push(`${entry.key} ${String(entry.data.score)}`);
      total += entry.data.score;
    } else {
      lines.push(`${entry.key} excluded by the gate`);
    }
  }
  return { lines, total };
}

/** A report body that lists only succeeded members, silently dropping every exclusion. */
function renderIncluded(entries: ISummaryEntries): IReport {
  logEntries(entries);
  const included = entries.flatMap((entry) => entry.status === 'succeeded' ? [entry.data.score] : []);
  return { lines: entries.flatMap((entry) => entry.status === 'succeeded' ? [entry.key] : []), total: included.reduce((sum, score) => sum + score, 0) };
}

/** A report body that reads a skipped entry's data, as untyped author code can. */
function renderReadingSkipped(entries: ISummaryEntries): IReport {
  logEntries(entries);
  for (const entry of entries) {
    if (entry.status === 'skipped') {
      // Strict fold entries forbid this read: a skipped member carries no data.
      void Reflect.get(entry, 'data');
    }
  }
  return { lines: [], total: 0 };
}

/** Which fold body a build declares. */
export type IReportBody = 'lists-skipped' | 'omits-skipped' | 'reads-skipped';

/** Author-visible variations of one fixture build. */
export interface IVariation {
  /** Registration order of helpers, steps and templates. */
  readonly order?: 'forward' | 'reversed';
  /** The gate threshold input. */
  readonly minimumAuthored?: number;
  /** The fold body. */
  readonly report?: IReportBody;
}

/** One fresh composition with its builders and the descriptors tests use. */
export interface IFoldFixture {
  readonly builders: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  /** The composition-level collection step. */
  readonly collection: IStepDescriptor;
  /** The strict fold's composition-level step. */
  readonly report: IStepDescriptor;
  /** The template step the fold consumes (no member key). */
  readonly over: IStepDescriptor;
  /** The summary instance descriptor of one member. */
  instance(memberKey: string): IStepDescriptor;
}

/** Order a registration list by the variation. */
function ordered<T>(items: readonly T[], variation: IVariation): T[] {
  return variation.order === 'reversed' ? [...items].reverse() : [...items];
}

/** Compose the strict-fold fixture with fresh allocations. */
export function composeFold(variation: IVariation = {}): IFoldFixture {
  const builders: IAuthoring<IInputs, IHelpers> = declarations<IAuthoringFamily<IInputs, IHelpers>>();
  const { source, template, fold, compose } = builders;

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
  const report = variation.report === 'omits-skipped'
    ? fold({ subject: reportSubject, over, run: ({ members, helpers }) => helpers.renderIncluded(members) })
    : variation.report === 'reads-skipped'
      ? fold({ subject: reportSubject, over, run: ({ members, helpers }) => helpers.renderReadingSkipped(members) })
      : fold({ subject: reportSubject, over, run: ({ members, helpers }) => helpers.render(members) });

  const inputs = [{ slot: 'config', value: { minimumAuthored: variation.minimumAuthored ?? 1 } }];
  const helpers = ordered([
    { slot: 'discover', helper: discover },
    { slot: 'discoveryFinal', helper: discoveryFinal },
    { slot: 'meets', helper: meets },
    { slot: 'summarize', helper: summarize },
    { slot: 'render', helper: render },
    { slot: 'renderIncluded', helper: renderIncluded },
    { slot: 'renderReadingSkipped', helper: renderReadingSkipped },
  ], variation);
  const compositionSteps = ordered([{ slot: 'contributors', declaration: roster }, { slot: 'report', declaration: report }], variation);
  const composition = compose({ scope: analysis, inputs, helpers, steps: compositionSteps, templates: [contributor] });

  return {
    builders,
    composition,
    collection: Object.freeze({ scope: analysis, role: 'step', slot: 'contributors' }),
    report: Object.freeze({ scope: analysis, role: 'step', slot: 'report' }),
    over: Object.freeze({ scope: analysis, role: 'step', slot: 'summary', template: 'contributor', collection: 'contributors' }),
    instance: (memberKey) => Object.freeze({ scope: analysis, role: 'step', slot: 'summary', template: 'contributor', collection: 'contributors', memberKey }),
  };
}
