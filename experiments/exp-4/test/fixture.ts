/**
 * The EXP-4 composition fixture shared by unit tests and both restart
 * processes: contributor discovery, a fanout template with a tracked activity
 * gate and a memoized summary calling one supplied `assessor` slot, and the
 * strict repository report. Every call allocates fresh objects; options vary
 * declaration order and correspondence without touching the portable probe.
 */
import { compose, lookup, parseRecord, step } from '../src/protocol.js';
import type {
  IBuilder,
  IData,
  IFoldBody,
  IGateBody,
  IGraph,
  IHistory,
  IInvocationRecord,
  IMemoBody,
  ISources,
  ITemplateBuilder,
  ITemplateStepHandle,
  IUnreferencedRecord,
} from '../src/protocol.js';
import { activityGate, assessorA, assessorB, assessorC, reportBody, summaryBody } from './bodies.js';

/** Which implementation(s), if any, the composition supplies to the `assessor` slot. */
export type IAssessorChoice = 'A' | 'B' | 'C' | 'missing' | 'ambiguous';

/** Composition variants; each defaults to the process-A baseline. */
export interface IGraphOptions {
  readonly assessor?: IAssessorChoice;
  readonly supplied?: IMemoBody;
  readonly summary?: IMemoBody;
  readonly summarySlot?: string;
  readonly collectionSlot?: string;
  readonly customKey?: boolean;
  readonly reversed?: boolean;
  readonly gate?: IGateBody;
  readonly fold?: IFoldBody;
  readonly untypedGate?: unknown;
}

/** A built graph plus the author-side artifacts a test may try to misuse after freeze. */
export interface IBuiltGraph {
  readonly graph: IGraph;
  readonly factoryCalls: () => number;
  readonly templateArray: ITemplateStepHandle[];
  readonly lateTemplate: () => ITemplateBuilder | undefined;
  readonly lateBuilder: () => IBuilder | undefined;
}

/** The custom key reads the member's login; it must be a nonempty string. */
function loginKey(record: IData): string {
  const login = lookup(record, ['login']);
  if (!login.found || typeof login.value !== 'string') {
    throw new TypeError('login key requires a string login');
  }
  return login.value;
}

/** Supply the selected implementation(s) to the declared slot. */
function supplyAssessor(builder: IBuilder, choice: IAssessorChoice, supplied: IMemoBody | undefined): ReturnType<IBuilder['callable']> {
  const assessor = builder.callable('assessor');
  if (supplied !== undefined) {
    builder.supply(assessor, step(supplied, 'custom assessor'));
    return assessor;
  }
  if (choice === 'missing') {
    return assessor;
  }
  const first = choice === 'B' ? assessorB : choice === 'C' ? assessorC : assessorA;
  builder.supply(assessor, step(first, `assessor ${choice}`));
  if (choice === 'ambiguous') {
    builder.supply(assessor, step(assessorB, 'second assessor'));
  }
  return assessor;
}

/** Build the fixture composition; `reversed` reverses every declaration's registration order. */
export function buildGraph(options: IGraphOptions = {}): IBuiltGraph {
  let factoryCalls = 0;
  const templateArray: ITemplateStepHandle[] = [];
  let lateTemplate: ITemplateBuilder | undefined;
  let lateBuilder: IBuilder | undefined;
  const summarySlot = options.summarySlot ?? 'summary';
  const graph = compose('contribution-report', builder => {
    lateBuilder = builder;
    const declareInputs = (): void => {
      if (options.reversed) {
        builder.input('pulls');
        builder.input('config');
      } else {
        builder.input('config');
        builder.input('pulls');
      }
    };
    if (!options.reversed) {
      declareInputs();
    }
    const assessor = supplyAssessor(builder, options.assessor ?? 'A', options.supplied);
    const discovery = builder.collection(options.collectionSlot ?? 'discovery');
    if (options.reversed) {
      declareInputs();
    }
    const fanout = builder.fanout('contributor', {
      collection: discovery,
      ...(options.customKey ? { key: loginKey } : {}),
      template: member => {
        factoryCalls++;
        lateTemplate = member;
        const declareGate = (): void => {
          if (options.untypedGate !== undefined) {
            Reflect.apply(member.gate, member, [options.untypedGate]);
          } else {
            member.gate(options.gate ?? activityGate);
          }
        };
        if (!options.reversed) {
          declareGate();
        }
        templateArray.push(member.memo(summarySlot, options.summary ?? summaryBody, [assessor]));
        if (options.reversed) {
          declareGate();
        }
        return templateArray;
      },
    });
    builder.fold('report', fanout.step(summarySlot), options.fold ?? reportBody);
  });
  return {
    graph,
    factoryCalls: () => factoryCalls,
    templateArray,
    lateTemplate: () => lateTemplate,
    lateBuilder: () => lateBuilder,
  };
}

/** A discovered contributor record; unread `bio` exists to prove unread fields do not matter. */
export type IContributorRecord = { id: string; login: string; bio: string; activity: number; prs: string[] };

/** A PR evidence record forwarded to the assessor through the `pulls` input. */
export type IPullRecord = { size: number; title: string };

/** Mutable per-process fixture data; scenarios edit fresh copies before a pass. */
export type IFixtureData = {
  status: 'complete' | 'open';
  contributors: IContributorRecord[];
  pulls: Record<string, IPullRecord>;
  config: { minActivity: number; unread: string };
};

/** Baseline data: alice and carol pass the gate (minimum 2); bob (activity 1) is gated out. */
export function baseData(): IFixtureData {
  return {
    status: 'complete',
    contributors: [
      { id: 'c-1', login: 'alice', bio: 'maintainer', activity: 5, prs: ['pr-1', 'pr-2'] },
      { id: 'c-2', login: 'bob', bio: 'visitor', activity: 1, prs: ['pr-3'] },
      { id: 'c-3', login: 'carol', bio: 'reviewer', activity: 3, prs: ['pr-4'] },
    ],
    pulls: {
      'pr-1': { size: 150, title: 'Refactor parser' },
      'pr-2': { size: 20, title: 'Fix typo' },
      'pr-3': { size: 500, title: 'Rewrite' },
      'pr-4': { size: 80, title: 'Add test' },
      'pr-5': { size: 10, title: 'Docs' },
      'pr-6': { size: 30, title: 'Tidy' },
    },
    config: { minActivity: 2, unread: 'first' },
  };
}

/** Extra members used by insertion and readiness scenarios. */
export const dave: IContributorRecord = { id: 'c-4', login: 'dave', bio: 'new', activity: 4, prs: ['pr-6'] };
/** A member whose work the fake scheduler may cancel. */
export const erin: IContributorRecord = { id: 'c-5', login: 'erin', bio: 'new', activity: 4, prs: ['pr-5'] };

/** Current source hooks over fixture data, counting how often each hook is consulted. */
export function sourcesFor(data: IFixtureData, collectionSlot = 'discovery'): { readonly sources: ISources; readonly hookCalls: Record<string, number> } {
  const hookCalls: Record<string, number> = { config: 0, pulls: 0, collection: 0 };
  const count = (name: string): void => {
    hookCalls[name] = (hookCalls[name] ?? 0) + 1;
  };
  return {
    hookCalls,
    sources: {
      inputs: {
        config: () => {
          count('config');
          return { ...data.config };
        },
        pulls: () => {
          count('pulls');
          return Object.fromEntries(Object.entries(data.pulls).map(([id, pull]) => [id, { ...pull }]));
        },
      },
      collections: {
        [collectionSlot]: () => {
          count('collection');
          return { status: data.status, members: data.contributors.map(member => ({ ...member, prs: [...member.prs] })) };
        },
      },
    },
  };
}

/** An append-only in-memory History; exact references are `result-N` in append order. */
export class MemoryHistory implements IHistory {
  readonly records: IInvocationRecord[];
  next: number;

  constructor(records: readonly IInvocationRecord[] = [], next = 1) {
    this.records = [...records];
    this.next = next;
  }

  /** Newest first, matching identity only; no name, text or ordinal fallback. */
  candidates(identity: string): readonly IInvocationRecord[] {
    return this.records.filter(record => record.identity === identity).reverse();
  }

  /** Append never rewrites an earlier record. */
  append(record: IUnreferencedRecord): string {
    const reference = `result-${this.next}`;
    this.next++;
    this.records.push({ ...record, reference });
    return reference;
  }

  /** Rebuild from untrusted JSON through the probe's own record parser. */
  static fromJson(value: unknown): MemoryHistory {
    if (typeof value !== 'object' || value === null || !('records' in value) || !('next' in value)
      || !Array.isArray(value.records) || typeof value.next !== 'number') {
      throw new TypeError('Invalid EXP-4 fixture history');
    }
    const records: readonly unknown[] = value.records;
    return new MemoryHistory(records.map(parseRecord), value.next);
  }
}
