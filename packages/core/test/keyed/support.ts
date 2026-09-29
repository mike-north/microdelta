/**
 * Assembly support for keyed-member tests. A session stands in for one
 * process lifetime: the facade's workspace over a durable SQLite History file
 * and a freshly composed keyed fixture. One workspace run resolves the
 * template's `summary` for every current member through Run Supervision and
 * reports each member's typed outcome. The same session code runs inside the
 * separate worker processes of the restart suite, so in-process and
 * cross-process evidence share one assembly and one JSON-safe report.
 *
 * @see ../../../../docs/plans/m4-composition.md ("Templates, keys and gates", planned evidence names)
 */
import { randomUUID } from 'node:crypto';

import { openWorkspace } from '../../src/index.js';
import type { IAdmissionDecision, IAdmissionRequest, IRunEvent } from '../../src/index.js';
import { composeKeyed, world } from './fixture.js';
import type { IKeyed, IVariation } from './fixture.js';

/** The environment every keyed session selects. */
export const environment = 'env:keyed';

/** The logical store every keyed session uses. */
export const logicalStore = 'store:keyed';

/** A JSON-safe description of one member's typed outcome. */
export interface IMemberReport {
  readonly status: 'succeeded' | 'skipped' | 'pending' | 'failed' | 'cancelled';
  /** For succeeded members: reused or published. */
  readonly kind?: string;
  /** For succeeded members: the exact reference. */
  readonly reference?: string;
  /** For succeeded members: why earlier candidates were not reused. */
  readonly misses?: readonly string[];
  /** For pending and cancelled members: the refusal reason and the refused step. */
  readonly reason?: string;
  readonly refused?: string;
  /** For failed members: the typed code, message and underlying cause. */
  readonly code?: string;
  readonly message?: string;
  readonly cause?: string;
  /** The gate evidence: selection and the binding roots of the facts it consumed. */
  readonly gate?: { readonly selected: string; readonly bindings: readonly string[] };
}

/** A JSON-safe description of how discovery settled. */
export type IDiscoveryReport =
  | { readonly kind: 'keyed'; readonly completion: string; readonly keys: readonly string[]; readonly reference: string }
  | {
      readonly kind: 'rejected';
      readonly reference: string;
      readonly reason: string;
      readonly key: string | null;
      readonly collection: string;
      readonly template: string;
      readonly identity: string | null;
      readonly customKey: boolean;
      readonly message: string;
    }
  | { readonly kind: 'pending' | 'cancelled'; readonly reason: string };

/** Everything one keyed run reports. */
export interface IKeyedReport {
  readonly discovery: IDiscoveryReport;
  readonly members: Readonly<Record<string, IMemberReport>>;
  /** Every admission request, in order, as `<kind>:<subject>`. */
  readonly admissions: readonly string[];
  /** Every framework lifecycle event, in order, as `<slot>/<member key>:<phase>`. */
  readonly events: readonly string[];
  /** The helper log of this process. */
  readonly log: readonly string[];
  /** Template factory invocations while composing this process's build. */
  readonly factoryCalls: number;
  /** The frozen topology, as JSON. */
  readonly topology: string;
  /** The run's post-commit diagnostics. */
  readonly diagnostics: readonly string[];
}

/**
 * The world's admission decision: by `<slot>/<member key>` for any step,
 * else by member key for a summary instance, else admission. A `throws`
 * decision makes the admission port itself fail.
 */
function decide(request: IAdmissionRequest): IAdmissionDecision {
  const stepName = `${request.step.slot}/${request.step.memberKey ?? ''}`;
  const key = request.step.template !== undefined && request.step.slot === 'summary' ? request.step.memberKey : undefined;
  const decision = world.stepDecisions[stepName] ?? (key === undefined ? undefined : world.decisions[key]);
  if (decision === 'throws') {
    throw new Error(`the admission service failed for ${stepName}`);
  }
  return decision === undefined ? { kind: 'admitted' } : { kind: decision, reason: `${decision} by the fixture policy for ${key ?? stepName}` };
}

/** Describe an event step compactly. */
function eventName(event: IRunEvent): string | undefined {
  return event.kind === 'step' ? `${event.event.step.slot}/${event.event.step.memberKey ?? ''}:${event.event.phase}` : undefined;
}

/** A readable cause chain entry. */
function causeOf(error: Error): string | undefined {
  const cause: unknown = error.cause;
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : cause === undefined ? undefined : String(cause);
}

/**
 * Open a workspace over `location`, compose the fixture afresh, resolve the
 * template's summaries for every current member in one supervised run and
 * close the workspace. Only durable History and the world survive.
 */
export async function runKeyed(location: string, variation: IVariation = {}): Promise<IKeyedReport> {
  const workspace = openWorkspace({ location, logicalStore });
  const keyed: IKeyed = composeKeyed(variation);
  const admissions: string[] = [];
  const events: string[] = [];
  try {
    const result = await workspace.run({
      authoring: keyed.builders,
      composition: keyed.composition,
      environment,
      admission: {
        admit(request) {
          admissions.push(`${request.kind}:${request.subject.subject}`);
          return decide(request);
        },
      },
      observers: [{
        observe(event) {
          const name = eventName(event);
          if (name !== undefined) {
            events.push(name);
          }
        },
      }],
    }, (run) => run.resolveMembers({ template: keyed.template, step: 'summary' }, { requestKey: `keyed-request:${randomUUID()}` }));
    const report = result.value;
    const members: Record<string, IMemberReport> = {};
    for (const member of report.members) {
      const gate = member.gate === undefined ? {} : { gate: { selected: member.gate.selected, bindings: [...new Set(member.gate.observations.map((item) => item.binding.path[0] ?? ''))].sort() } };
      switch (member.status) {
        case 'succeeded':
          members[member.key] = { status: member.status, kind: member.outcome.kind, reference: member.outcome.reference.locator, misses: member.outcome.misses.map((item) => item.reason), ...gate };
          break;
        case 'skipped':
          members[member.key] = { status: member.status, ...gate };
          break;
        case 'pending':
        case 'cancelled':
          members[member.key] = { status: member.status, reason: member.reason, refused: `${member.refused.slot}/${member.refused.memberKey ?? ''}`, ...gate };
          break;
        case 'failed': {
          const cause = causeOf(member.error);
          members[member.key] = { status: member.status, code: member.error.code, message: member.error.message, ...(cause === undefined ? {} : { cause }), ...gate };
          break;
        }
        default: {
          const exhaustive: never = member;
          return exhaustive;
        }
      }
    }
    const discovery = report.discovery;
    let described: IDiscoveryReport;
    switch (discovery.kind) {
      case 'keyed':
        described = { kind: discovery.kind, completion: discovery.completion, keys: discovery.keys, reference: discovery.reference.locator };
        break;
      case 'rejected':
        described = {
          kind: discovery.kind,
          reference: discovery.reference.locator,
          reason: discovery.diagnostic.reason,
          key: discovery.diagnostic.key ?? null,
          collection: discovery.diagnostic.collection,
          template: discovery.diagnostic.template,
          identity: discovery.diagnostic.identity ?? null,
          customKey: discovery.diagnostic.customKey,
          message: discovery.diagnostic.message,
        };
        break;
      case 'pending':
      case 'cancelled':
        described = { kind: discovery.kind, reason: discovery.reason };
        break;
      default: {
        const exhaustive: never = discovery;
        return exhaustive;
      }
    }
    return {
      discovery: described,
      members,
      admissions,
      events,
      log: [...world.log],
      factoryCalls: keyed.factoryCalls,
      topology: JSON.stringify(keyed.composition.topology),
      diagnostics: result.diagnostics,
    };
  } finally {
    workspace.close();
  }
}

/** The helper log entries starting with `prefix`, without it. */
export function logged(report: Pick<IKeyedReport, 'log'>, prefix: string): readonly string[] {
  return report.log.filter((entry) => entry.startsWith(`${prefix}:`)).map((entry) => entry.slice(prefix.length + 1));
}

/** The exact reference of a succeeded member, or a failure naming what was there. */
export function referenceOf(report: IKeyedReport, key: string): string {
  const member = report.members[key];
  if (member?.reference === undefined) {
    throw new Error(`expected ${key} to succeed, observed ${JSON.stringify(member)}`);
  }
  return member.reference;
}
