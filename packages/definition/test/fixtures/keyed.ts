/**
 * The M4 keyed contributor fixture: a composition-level discovery source that
 * is a keyed collection with designated identity `key`, one fanout template
 * `contributor` built once against a symbolic member (an activity source and a
 * summary memo over it), an optional tracked gate and custom key, and a strict
 * fold `report` over the member summaries. Every build allocates fresh
 * declarations and callbacks, standing in for a new process, and counts its
 * own factory invocations.
 *
 * @see ../../../../docs/plans/m4-composition.md (authoring shape; concrete fixture decisions)
 * @see ../../../../docs/spec/composition.md (CMP-4, CMP-8, EXP-4 template selection)
 */
import type { IBindingDescriptor, ICollectionResult, IMemberBinding, IMemberBuilder, ISourceDeclaration } from '../../src/index.js';
import { builders, type ITestFamily } from './contributors.js';

export const { source, memo, template, fold, compose, openInvocation, gateOf } = builders;

/** The analysis scope of the keyed fixture. */
export const keyedScope = 'contribution-report:acme/widget:m4';

/** A discovered contributor record, as the plan's discovery source yields it. */
export interface IContributor {
  /** Designated identity; optional so a record without it can exercise keying failure. */
  readonly key?: string;
  /** The upstream profile id used by the custom-key variant. */
  readonly id: string;
  readonly login: string;
  readonly authored: number;
}

/** The discovery source's keyed collection result. */
export type IContributors = ICollectionResult<IContributor>;

/** Ada, Ben and Cy as the plan's fixture data discovers them. */
export const ada: IContributor = { key: 'person:ada', id: 'gh:1001', login: 'ada', authored: 3 };
export const ben: IContributor = { key: 'person:ben', id: 'gh:1002', login: 'ben', authored: 2 };
export const cy: IContributor = { key: 'person:cy', id: 'gh:1003', login: 'cy', authored: 1 };

/** Complete opaque subject prefixes the author chooses for member steps. */
export const activityPrefix = 'activity:acme/widget:2026-Q1';
export const summaryPrefix = 'summary:acme/widget:2026-Q1';

/** Author-visible choices that vary one build without changing unrelated structure. */
export interface IKeyedVariation {
  /** Use the upstream profile id as an explicit custom key. */
  readonly customKey?: boolean;
  /** Declare the tracked gate `member.authored >= minimumAuthored`. */
  readonly gate?: boolean;
  /** The template slot (default `contributor`). */
  readonly templateSlot?: string;
  /** The composition-level slot holding the collection source (default `contributors`). */
  readonly collectionSlot?: string;
  /** Register composition-level steps in reverse order. */
  readonly reversed?: boolean;
}

/** Callback invocation counts; composition, keying and resolution must leave these at zero. */
export interface ICallCounts {
  gate: number;
  key: number;
  bodies: number;
}

/** Declare the member summary through the member builder, typed from its activity child. */
function summaryOf(member: IMemberBuilder<ITestFamily, IContributor>, activity: ISourceDeclaration<ITestFamily, string, IMemberBinding<ITestFamily, IContributor>>, calls: ICallCounts) {
  return member.memo({
    subject: member.subject(summaryPrefix),
    children: { activity },
    run: async ({ calls: handles }): Promise<string> => {
      calls.bodies++;
      const { data } = await handles.activity();
      return `summary of ${data}`;
    },
  });
}

/** Build the keyed composition with fresh allocations. */
export function buildKeyed(variation: IKeyedVariation = {}) {
  let factoryCalls = 0;
  let captured: IMemberBuilder<ITestFamily, IContributor> | undefined;
  let returned: Record<string, unknown> | undefined;
  const calls: ICallCounts = { gate: 0, key: 0, bodies: 0 };
  const contributors = source<IContributors>({
    subject: 'contributors:acme/widget:2026-Q1',
    collection: { identity: 'key' },
    run: () => {
      calls.bodies++;
      return { members: [ada, ben, cy], status: 'complete' };
    },
  });
  const customKey = (member: IContributor): string => {
    calls.key++;
    return member.id;
  };
  const gate = ({ member, minimumAuthored }: { readonly member: IContributor; readonly [binding: string]: unknown }): boolean => {
    calls.gate++;
    return typeof minimumAuthored === 'number' && member.authored >= minimumAuthored;
  };
  const contributor = template({
    slot: variation.templateSlot ?? 'contributor',
    collection: contributors,
    ...(variation.customKey === true ? { key: customKey } : {}),
    ...(variation.gate === true ? { gate } : {}),
    steps: (member) => {
      factoryCalls++;
      captured = member;
      const activity = member.source<string>({
        subject: member.subject(activityPrefix),
        run: () => {
          calls.bodies++;
          return 'activity';
        },
      });
      const steps = { activity, summary: summaryOf(member, activity, calls) };
      returned = steps;
      return steps;
    },
  });
  const report = fold({
    subject: 'report:acme/widget:2026-Q1',
    over: { template: contributor, step: 'summary' },
    run: ({ members }): string => {
      calls.bodies++;
      return members.map((entry) => entry.status === 'succeeded' ? `${entry.key}=${entry.data}` : `${entry.key} skipped`).join('; ');
    },
  });
  const steps = [
    { slot: variation.collectionSlot ?? 'contributors', declaration: contributors },
    { slot: 'report', declaration: report },
  ];
  const composition = compose({ scope: keyedScope, steps: variation.reversed === true ? [...steps].reverse() : steps, templates: [contributor] });
  return {
    composition,
    contributors,
    contributor,
    report,
    /** How many times this build's template factory has run. */
    factoryCalls: (): number => factoryCalls,
    /** The member builder the factory received, captured to probe post-freeze calls. */
    capturedMember: (): IMemberBuilder<ITestFamily, IContributor> | undefined => captured,
    /** The author's own step record the factory returned, retained to probe later mutation. */
    returnedSteps: (): Record<string, unknown> | undefined => returned,
    calls,
  };
}

/** One keyed build's declarations plus the probes tests inspect. */
export type IKeyedBuild = ReturnType<typeof buildKeyed>;

/** The structural descriptor of one template member instance. */
export function instanceDescriptor(
  step: string,
  memberKey: string,
  fields: { readonly template?: string; readonly collection?: string; readonly scope?: string } = {},
): IBindingDescriptor {
  return {
    scope: fields.scope ?? keyedScope,
    role: 'step',
    slot: step,
    template: fields.template ?? 'contributor',
    collection: fields.collection ?? 'contributors',
    memberKey,
  };
}

/** The template step descriptor (no member key). */
export function templateStepDescriptor(step: string, fields: { readonly template?: string; readonly collection?: string } = {}): IBindingDescriptor {
  return { scope: keyedScope, role: 'step', slot: step, template: fields.template ?? 'contributor', collection: fields.collection ?? 'contributors' };
}

/** A composition-level step descriptor. */
export function compositionStep(slot: string): IBindingDescriptor {
  return { scope: keyedScope, role: 'step', slot };
}
