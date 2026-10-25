/**
 * Pure interpretation of a source's bounded retry evidence (RUN-011/017).
 * This module captures exact non-secret policy identities, validates source
 * facts and closed decisions, and projects one operation's private-run
 * history. It never invokes callbacks, reads stores, controls time, or grants
 * a request attempt; the operation engine owns those lifecycle authorities.
 */
import { SupervisionError } from './errors.js';
import type {
  IRetryAttemptSummary,
  IRetryDecision,
  IRetryDecisionInput,
  IRetryFacts,
  IRetryOutcome,
  IRetrySourceScope,
  ISourceRetryPolicy,
} from './operations.js';
import type { IOperationRecord } from './records.js';

/** Source and provider fact identifiers are bounded labels, never credentials. */
const retryIdentifierRule = /^[A-Za-z0-9_.:-]{1,128}$/u;

/** The bounded default wait sequence for actually sent attempts. */
const defaultRetryBackoff = Object.freeze({ initialMilliseconds: 2_000, capMilliseconds: 60_000 });

/** Read caller-owned configuration without letting a throwing accessor expose private text. */
function configurationField(value: object, name: string): unknown {
  try {
    return Reflect.get(value, name);
  } catch {
    throw new SupervisionError('invalid-request', 'A retry policy registration or source tuple is malformed');
  }
}

/** The default delay after this invocation's first or later sent attempt. */
export function defaultRetryDelay(spent: number): number {
  const doublings = Math.max(0, spent - 1);
  return doublings >= 5 ? defaultRetryBackoff.capMilliseconds : Math.min(defaultRetryBackoff.capMilliseconds, defaultRetryBackoff.initialMilliseconds * 2 ** doublings);
}

/** Capture an exact source tuple before caller mutation can change selection. */
export function validatedRetrySource(value: unknown, name: string): IRetrySourceScope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SupervisionError('invalid-request', `An operation's ${name} must identify source, service and connection`);
  }
  const source = configurationField(value, 'source');
  const service = configurationField(value, 'service');
  const connection = configurationField(value, 'connection');
  if (typeof source !== 'string' || !retryIdentifierRule.test(source)
    || typeof service !== 'string' || !retryIdentifierRule.test(service)
    || typeof connection !== 'string' || !retryIdentifierRule.test(connection)) {
    throw new SupervisionError('invalid-request', `An operation's ${name} must contain bounded non-secret identifiers`);
  }
  return Object.freeze({ source, service, connection });
}

/** Capture a run's exact registrations and reject duplicate identities or scopes. */
export function validatedRetryPolicies(value: readonly ISourceRetryPolicy[] | undefined): readonly ISourceRetryPolicy[] {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    throw new SupervisionError('invalid-request', 'A run retryPolicies value must be an array');
  }
  const ids = new Set<string>();
  const scopes = new Set<string>();
  let policies: ISourceRetryPolicy[];
  try {
    policies = value.map((candidate: unknown): ISourceRetryPolicy => {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        throw new SupervisionError('invalid-request', 'A retry policy registration is malformed');
      }
      const id = configurationField(candidate, 'id');
      const rawScope = configurationField(candidate, 'scope');
      const decide = configurationField(candidate, 'decide');
      const scope = validatedRetrySource(rawScope, 'retry policy scope');
      if (typeof id !== 'string' || !retryIdentifierRule.test(id) || !isRetryCallback(decide)) {
        throw new SupervisionError('invalid-request', 'A retry policy needs a bounded identifier and a decision function');
      }
      const scopeKey = JSON.stringify([scope.source, scope.service, scope.connection]);
      if (ids.has(id) || scopes.has(scopeKey)) {
        throw new SupervisionError('invalid-request', 'Retry policy identifiers and exact scopes must be unique');
      }
      ids.add(id);
      scopes.add(scopeKey);
      return Object.freeze({ id, scope, decide: (input: IRetryDecisionInput) => decide(input) });
    });
  } catch {
    // Array index access can itself run caller code. Contain its private
    // exception before admission, just like a policy's field getters.
    throw new SupervisionError('invalid-request', 'A retry policy registration is malformed');
  }
  return Object.freeze(policies);
}

/** Narrow a registration's callable value before preserving it for later invocation. */
function isRetryCallback(value: unknown): value is ISourceRetryPolicy['decide'] {
  return typeof value === 'function';
}

/** Whether two captured tuples identify the same policy scope, including absence. */
export function sameRetrySource(left: IRetrySourceScope | undefined, right: IRetrySourceScope | undefined): boolean {
  return left === undefined ? right === undefined : right !== undefined
    && left.source === right.source && left.service === right.service && left.connection === right.connection;
}

/** Select only one exact source/service/connection registration. */
export function selectRetryPolicy(policies: readonly ISourceRetryPolicy[], source: IRetrySourceScope | undefined): ISourceRetryPolicy | undefined {
  return source === undefined ? undefined : policies.find((candidate) => sameRetrySource(candidate.scope, source));
}

/** Snapshot only bounded adapter facts, rejecting generic metadata and aliases. */
export function retryFacts(value: unknown): IRetryFacts {
  if (value === undefined) {
    return Object.freeze({});
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).some((key) => !['httpStatus', 'providerCode', 'conditions'].includes(key))) {
    throw new SupervisionError('invalid-request', 'A response has malformed retry facts');
  }
  const httpStatus: unknown = Reflect.get(value, 'httpStatus');
  const providerCode: unknown = Reflect.get(value, 'providerCode');
  const rawConditions: unknown = Reflect.get(value, 'conditions');
  if (httpStatus !== undefined && (typeof httpStatus !== 'number' || !Number.isSafeInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) {
    throw new SupervisionError('invalid-request', 'A response has an invalid retry HTTP status fact');
  }
  if (providerCode !== undefined && (typeof providerCode !== 'string' || !retryIdentifierRule.test(providerCode))) {
    throw new SupervisionError('invalid-request', 'A response has an invalid retry provider-code fact');
  }
  if (rawConditions !== undefined && (!Array.isArray(rawConditions) || rawConditions.length > 8)) {
    throw new SupervisionError('invalid-request', 'A response has invalid retry conditions');
  }
  const conditions = rawConditions === undefined ? undefined : rawConditions.map((condition: unknown) => {
    if (typeof condition !== 'string' || !retryIdentifierRule.test(condition)) {
      throw new SupervisionError('invalid-request', 'A response has an invalid retry condition');
    }
    return condition;
  });
  if (conditions !== undefined && new Set(conditions).size !== conditions.length) {
    throw new SupervisionError('invalid-request', 'A response repeats a retry condition');
  }
  return Object.freeze({
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(providerCode === undefined ? {} : { providerCode }),
    ...(conditions === undefined ? {} : { conditions: Object.freeze(conditions) }),
  });
}

/** Read an independent provider floor; facts never carry timing authority. */
export function retryFloor(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SupervisionError('invalid-request', 'A response has an invalid retry not-before time');
  }
  return value;
}

/** Normalize exactly one closed policy result without grant or fallback fields. */
export function validatedRetryDecision(value: unknown): IRetryDecision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SupervisionError('operation-classification-failed', 'A source retry policy returned an invalid decision');
  }
  const kind: unknown = Reflect.get(value, 'kind');
  const keys = Object.keys(value);
  if (kind === 'retry-now' && keys.length === 1 && keys[0] === 'kind') {
    return Object.freeze({ kind });
  }
  if (kind === 'stop' && keys.length === 1 && keys[0] === 'kind') {
    return Object.freeze({ kind });
  }
  if (kind === 'retry-after' && keys.length === 2 && keys.includes('kind') && keys.includes('delayMilliseconds')) {
    const delayMilliseconds: unknown = Reflect.get(value, 'delayMilliseconds');
    if (typeof delayMilliseconds === 'number' && Number.isSafeInteger(delayMilliseconds) && delayMilliseconds > 0) {
      return Object.freeze({ kind, delayMilliseconds });
    }
  }
  throw new SupervisionError('operation-classification-failed', 'A source retry policy returned an invalid decision');
}

/** Built-in classification covers normalized outcome only; provider facts are contextual evidence for custom policy. */
export function builtInRetryDecision(outcome: IRetryOutcome, delayMilliseconds: number): IRetryDecision {
  return outcome.kind === 'failed' && !outcome.transient
    ? { kind: 'stop' }
    : delayMilliseconds === 0 ? { kind: 'retry-now' } : { kind: 'retry-after', delayMilliseconds };
}

/** Convert a normalized refusal to a closed callback outcome. */
export function retryOutcome(response: IRetryOutcome): IRetryOutcome {
  return response.kind === 'failed'
    ? Object.freeze({ kind: 'failed', transient: response.transient })
    : Object.freeze({ kind: response.kind });
}

/** Bounded prior attempts of one operation and private run; current attempt is excluded. */
export function retryHistory(record: IOperationRecord, requestAttempt: string, runInstance: string, sentAttempts: number): IRetryDecisionInput['history'] {
  const eligible: IRetryAttemptSummary[] = record.attempts.flatMap((attempt) => {
    if (attempt.runInstance !== runInstance || attempt.requestAttempt === requestAttempt
      || (attempt.status !== 'failed' && attempt.status !== 'rate-limited' && attempt.status !== 'unknown')) {
      return [];
    }
    return [Object.freeze({
      requestAttempt: attempt.requestAttempt,
      status: attempt.status,
      usage: attempt.usage ?? 'none',
      // A prior decision is durable evidence. Give callbacks a detached,
      // frozen projection so they cannot alter the record used by this pass.
      ...(attempt.decision === undefined ? {} : { decision: Object.freeze({ ...attempt.decision }) }),
    })];
  });
  const omittedPriorAttempts = Math.max(0, eligible.length - 8);
  return Object.freeze({
    sentAttempts,
    prior: Object.freeze(eligible.slice(omittedPriorAttempts)),
    omittedPriorAttempts,
    ...(record.previousDelayMilliseconds === undefined ? {} : { previousDelayMilliseconds: record.previousDelayMilliseconds }),
  });
}
