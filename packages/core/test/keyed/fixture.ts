/**
 * The keyed-members authoring fixture: the contribution population reduced to
 * one fanout template over a discovered, keyed collection, written as an
 * author writes it against Definition's builders bound to the facade's
 * authoring family (exactly what the facade's `authoring()` returns, created
 * through Definition's generated declaration so the tracked-captures lint
 * recognizes the builder factory).
 *
 * - `contributors` is a composition-level keyed collection source. Its check
 *   discovers the roster held by the fixture world (the stand-in for an
 *   external service); its finality hook reports the world's current answer,
 *   so a test decides when discovery must run its check again.
 * - `contributor` is a template over that collection. Its factory runs once
 *   and returns two member steps: `activity`, a member source that reads its
 *   member's `key` to select that member's activity and whose finality
 *   accepts its previous result; and `summary`, a member memo that calls
 *   `activity`, then the supplied `describer` slot with the member's `login`
 *   forwarded from the member binding (`forward.member(['login'])`), and reads
 *   its member's `authored` directly. The summary consumes only the activity
 *   `window`, the description `label` and the member's `authored`.
 * - The gate requires a member when its `authored` count reaches the tracked
 *   input `config.minimumAuthored` (default 1).
 * - A member's designated identity is its `key` (`person:ada`); the
 *   custom-key variant keys by the upstream profile `id` (`gh:1001`). Only the
 *   activity source reads `key`; no member step reads `bio` or `id`.
 *
 * Member steps read their member through the `member` binding Definition
 * gives template instances: the view of the member's current keyed record.
 * Every `composeKeyed` call allocates fresh
 * declarations, callbacks and inputs, standing in for a new process;
 * `order: 'reversed'` registers helpers, steps, templates and supplies in
 * reverse. Counts and the event log are kept by the declared helpers each
 * callback calls, so callbacks capture nothing but their typed context and
 * Definition's canonical `forward`.
 *
 * Hand-derived expectations (docs/plans/m4-composition.md, concrete fixture
 * decisions): Ada authored 3, Ben 2 and Cy 1, so every member is required at
 * the default threshold 1; at threshold 2 Cy is skipped; at threshold 3 Ben
 * and Cy are. Each activity is `{ window: '2026-Q1', owner: <key> }` and each
 * summary `{ window: '2026-Q1', label: '@<login>', authored: <authored> }`.
 *
 * @see ../../../../docs/plans/m4-composition.md
 * @see ../../../../docs/spec/composition.md (CMP-1, CMP-4, CMP-8, CMP-9)
 * @see ../../../../docs/spec/tracking.md (COL-1..4)
 */
import { declarations } from '@microdelta/definition';
import type { IMemberBuilder } from '@microdelta/definition';

import { sourceOutcome } from '../../src/index.js';
import type { IAuthoring, IAuthoringFamily, IComposition, ISourceOutcome, IStepDescriptor, ITrackedView } from '../../src/index.js';

/** The analysis scope of the fixture composition. */
export const analysis = 'contribution-report:acme/widget:keyed';

/** One discovered contributor record. */
export interface IContributor {
  /** Designated identity; absent only in the missing-key variant. */
  readonly key?: string;
  /** Upstream profile id: the custom key. */
  readonly id: string;
  /** Consumed by each summary through the forwarded member binding. */
  readonly login: string;
  /** Consumed by the gate. */
  readonly authored: number;
  /** Never read by any member work. */
  readonly bio: string;
}

/** The discovery result: members and completion status. */
export interface IRoster {
  readonly members: readonly IContributor[];
  readonly status: 'complete' | 'open';
}

/** A member's activity, selected by its member's designated identity. The summary consumes only `window`. */
export interface IActivity {
  readonly window: string;
  readonly owner: string;
}

/** A supplied description. The summary consumes only `label`. */
export interface IDescription {
  readonly label: string;
}

/** A member summary. */
export interface ISummary {
  readonly window: string;
  readonly label: string;
  readonly authored: number;
}

/** The gate's tracked configuration. */
export interface IConfig {
  readonly minimumAuthored: number;
}

/** The declared input record. */
export interface IInputs {
  readonly config: IConfig;
}

/** The declared helper record. */
export interface IHelpers {
  readonly discover: () => ISourceOutcome<IRoster>;
  readonly discoveryFinal: () => boolean;
  readonly fetchActivity: (key: string) => ISourceOutcome<IActivity>;
  readonly meets: (login: string, authored: number, minimum: number) => boolean;
  readonly describe: (login: string) => IDescription;
  readonly summarize: (activity: ITrackedView<IActivity>, description: ITrackedView<IDescription>, authored: number) => ISummary;
}

/** How a gate misbehaves for one login, as untyped author code can. */
export type IGateFault = 'number' | 'undefined' | 'throws' | 'promise' | 'thenable';

/** An admission decision the fixture policy returns, or `throws` for an admission port that fails outright. */
export type IMemberDecision = 'denied' | 'cancelled' | 'throws';

/** The fixture world: remote data, policy answers and the ordered helper log. Plain JSON, so a worker process can load it. */
export interface IWorld {
  /** The roster discovery returns, in discovery order. */
  roster: IRoster;
  /** Whether discovery's finality accepts its eligible previous result. */
  discoveryFinal: boolean;
  /** Logins whose description fails. */
  failDescribe: string[];
  /** Gate misbehaviour by login. */
  gateFaults: Record<string, IGateFault>;
  /** Admission decisions for summary instances, by member key. */
  decisions: Record<string, IMemberDecision>;
  /** Admission decisions for any step, by `<slot>/<member key>` (empty member key for composition-wide slots). */
  stepDecisions: Record<string, IMemberDecision>;
  /** Every helper call, in order: `discover`, `activity:<key>`, `gate:<login>`, `describe:<login>`, `summary:<label>`. */
  log: string[];
}

/** Ada, Ben and Cy as discovered for acme/widget in 2026-Q1. */
export function contributors(): IContributor[] {
  return [
    { key: 'person:ada', id: 'gh:1001', login: 'ada', authored: 3, bio: 'Parser work' },
    { key: 'person:ben', id: 'gh:1002', login: 'ben', authored: 2, bio: 'Docs' },
    { key: 'person:cy', id: 'gh:1003', login: 'cy', authored: 1, bio: 'First PR' },
  ];
}

/** Dee, inserted by the insertion case. */
export function dee(): IContributor {
  return { key: 'person:dee', id: 'gh:1004', login: 'dee', authored: 4, bio: 'New' };
}

/** A fresh world: a complete roster of Ada, Ben and Cy, discovery accepted by finality, an empty log. */
export function createWorld(members: readonly IContributor[] = contributors(), status: IRoster['status'] = 'complete'): IWorld {
  return { roster: { members: [...members], status }, discoveryFinal: true, failDescribe: [], gateFaults: {}, decisions: {}, stepDecisions: {}, log: [] };
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

/** The activity adapter: the named member's activity in the fixture quarter. */
function fetchActivity(key: string): ISourceOutcome<IActivity> {
  world.log.push(`activity:${key}`);
  return sourceOutcome.fresh({ window: '2026-Q1', owner: key });
}

/**
 * The gate predicate: authored work reaches the threshold. A configured
 * fault makes it behave as untyped author code can: return a number,
 * `undefined`, a promise or a thenable, or throw.
 */
function meets(login: string, authored: number, minimum: number): unknown {
  world.log.push(`gate:${login}`);
  switch (world.gateFaults[login]) {
    case 'number':
      return authored;
    case 'undefined':
      return undefined;
    case 'throws':
      throw new Error(`gate lookup failed for ${login}`);
    case 'promise':
      return Promise.resolve(authored >= minimum);
    case 'thenable':
      return { then: (resolve: (value: boolean) => void): void => resolve(authored >= minimum) };
    case undefined:
      return authored >= minimum;
    default: {
      const exhaustive: never = world.gateFaults[login];
      return exhaustive;
    }
  }
}

/** The supplied description of one login. */
function describe(login: string): IDescription {
  world.log.push(`describe:${login}`);
  if (world.failDescribe.includes(login)) {
    throw new Error(`description service failed for ${login}`);
  }
  return { label: `@${login}` };
}

/** The member summary: consumes the activity window, the description label and the member's authored count only. */
function summarize(activity: ITrackedView<IActivity>, description: ITrackedView<IDescription>, authored: number): ISummary {
  world.log.push(`summary:${description.label}`);
  return { window: activity.window, label: description.label, authored };
}

/** Author-visible variations of one fixture build. */
export interface IVariation {
  /** Registration order of helpers, steps, templates and supplies. */
  readonly order?: 'forward' | 'reversed';
  /** Designated identity (`key`) or the custom key (`id`). */
  readonly key?: 'designated' | 'custom';
  /** The gate threshold input. */
  readonly minimumAuthored?: number;
  /** Mutate every author array, record and input object after composing. */
  readonly mutateAfterCompose?: boolean;
  /** A summary that tries to create an operation from its child's result. */
  readonly resultCreated?: boolean;
  /** A summary that makes both of its calls concurrently. */
  readonly concurrentCalls?: boolean;
  /** The template slot (default `contributor`); renaming it is changed correspondence. */
  readonly templateSlot?: string;
  /** The composition-level slot holding the collection (default `contributors`); moving it is changed correspondence. */
  readonly collectionSlot?: string;
}

/** One fresh composition with its builders and the descriptors tests use. */
export interface IKeyed {
  readonly builders: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  /** Template factory invocations while composing this build. */
  readonly factoryCalls: number;
  /** The template slot. */
  readonly template: string;
  /** The composition-level collection step. */
  readonly collection: IStepDescriptor;
  /** The instance descriptor of one member's step. */
  instance(step: 'activity' | 'summary', memberKey: string): IStepDescriptor;
}

/** The subject of every description call: the slot's subject function sees derived values only, and none are passed. */
export const descriptionSubject = 'description:acme/widget';

/** Order a registration list by the variation. */
function ordered<T>(items: readonly T[], variation: IVariation): T[] {
  return variation.order === 'reversed' ? [...items].reverse() : [...items];
}

/** Compose the keyed fixture with fresh allocations. */
export function composeKeyed(variation: IVariation = {}): IKeyed {
  const builders: IAuthoring<IInputs, IHelpers> = declarations<IAuthoringFamily<IInputs, IHelpers>>();
  const { source, stepSlot, suppliedStep, supply, forward, template, compose } = builders;
  const describer = stepSlot<readonly [string], IDescription>({ slot: 'describer' });

  const roster = source<IRoster>({
    subject: 'contributors:acme/widget:2026-Q1',
    collection: { identity: 'key' },
    finality: ({ helpers }) => helpers.discoveryFinal(),
    run: ({ helpers }) => helpers.discover(),
  });

  let factoryCalls = 0;
  /** The factory's returned record, kept so the mutation variant can change it after composing. */
  let authorRecord: Record<string, unknown> = {};
  const steps = (member: IMemberBuilder<IAuthoringFamily<IInputs, IHelpers>, IContributor>) => {
    factoryCalls += 1;
    const activity = member.source<IActivity>({
      subject: member.subject('activity:acme/widget:2026-Q1'),
      finality: () => true,
      run: ({ member, helpers }) => helpers.fetchActivity(member.key ?? ''),
    });
    const summary = variation.concurrentCalls === true
      ? member.memo({
          subject: member.subject('summary:acme/widget:2026-Q1'),
          children: { activity, describe: describer },
          run: async ({ calls, helpers, member: bound }) => {
            // Both declared calls start before either settles, so their refusals can arrive in either order.
            // eslint-disable-next-line microdelta/tracked-captures -- Promise.all only joins this body's own two declared calls; it reads no external value that could influence the result.
            const [activityResult, described] = await Promise.all([calls.activity(), calls.describe(forward.member<string>(['login']))]);
            return helpers.summarize(activityResult.data, described.data, bound.authored);
          },
        })
      : variation.resultCreated === true
      ? member.memo({
          subject: member.subject('summary:acme/widget:2026-Q1'),
          children: { activity, describe: describer },
          run: async ({ calls, helpers, member: bound }) => {
            const described = await calls.describe(forward.member<string>(['login']));
            // CMP-9: try to add an operation named by a child's result through the frozen member builder.
            // eslint-disable-next-line microdelta/tracked-captures -- Deliberate CMP-9 violation: the frozen member builder is captured to prove a result-created operation is rejected before any admission.
            member.memo({ subject: member.subject(described.data.label), run: () => ({ created: true }) });
            return helpers.summarize((await calls.activity()).data, described.data, bound.authored);
          },
        })
      : member.memo({
          subject: member.subject('summary:acme/widget:2026-Q1'),
          children: { activity, describe: describer },
          run: async ({ calls, helpers, member }) => {
            const activityResult = await calls.activity();
            const described = await calls.describe(forward.member<string>(['login']));
            return helpers.summarize(activityResult.data, described.data, member.authored);
          },
        });
    authorRecord = { activity, summary };
    return { activity, summary };
  };
  const contributor = variation.key === 'custom'
    ? template({
        slot: variation.templateSlot ?? 'contributor',
        collection: roster,
        key: (member) => member.id,
        gate: ({ member, inputs, helpers }) => helpers.meets(member.login, member.authored, inputs.config.minimumAuthored),
        steps,
      })
    : template({
        slot: variation.templateSlot ?? 'contributor',
        collection: roster,
        gate: ({ member, inputs, helpers }) => helpers.meets(member.login, member.authored, inputs.config.minimumAuthored),
        steps,
      });

  const describeStep = suppliedStep<readonly [string], IDescription>({
    label: 'describer',
    run: ({ args, helpers }) => helpers.describe(args[0]),
  });
  const config = { minimumAuthored: variation.minimumAuthored ?? 1 };
  const inputs = [{ slot: 'config', value: config }];
  const helpers = ordered([
    { slot: 'discover', helper: discover },
    { slot: 'discoveryFinal', helper: discoveryFinal },
    { slot: 'fetchActivity', helper: fetchActivity },
    { slot: 'meets', helper: meets },
    { slot: 'describe', helper: describe },
    { slot: 'summarize', helper: summarize },
  ], variation);
  const collectionSlot = variation.collectionSlot ?? 'contributors';
  const compositionSteps = ordered([{ slot: collectionSlot, declaration: roster }], variation);
  const templates = ordered([contributor], variation);
  const supplied = ordered([supply({ slot: describer, declaration: describeStep, subject: () => descriptionSubject })], variation);
  const composition = compose({ scope: analysis, inputs, helpers, steps: compositionSteps, templates, supplied });

  if (variation.mutateAfterCompose === true) {
    // CMP-1: every author-owned array, record and input object changes after the freeze.
    compositionSteps.push({ slot: 'late', declaration: roster });
    compositionSteps.reverse();
    templates.push(contributor);
    supplied.length = 0;
    helpers.reverse();
    inputs.push({ slot: 'late', value: { minimumAuthored: 99 } });
    config.minimumAuthored = 99;
    Reflect.deleteProperty(authorRecord, 'summary');
    authorRecord['late'] = roster;
  }

  return {
    builders,
    composition,
    factoryCalls,
    template: variation.templateSlot ?? 'contributor',
    collection: Object.freeze({ scope: analysis, role: 'step', slot: collectionSlot }),
    instance: (step, memberKey) => Object.freeze({ scope: analysis, role: 'step', slot: step, template: variation.templateSlot ?? 'contributor', collection: collectionSlot, memberKey }),
  };
}
